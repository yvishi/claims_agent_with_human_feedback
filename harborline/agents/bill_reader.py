"""Bill reader agent: claim documents -> structured, classified facts.

Read (local text/OCR) -> parse (code) -> classify (keywords; LLM for leftovers in iteration 2)
-> instruction check. Iteration 1 has no masking yet: nothing here leaves the machine.
"""
from __future__ import annotations

from harborline.docs.classify import classify
from harborline.docs.instructions import find_instructions, suspicious_lines
from harborline.llm import tasks as llm
from harborline.llm.client import LLMUnavailable
from harborline.docs.parser import parse_bill, parse_discharge, parse_receipt
from harborline.docs.reader import read_pdf_bytes
from harborline.privacy.masker import mask
from harborline.rules.engine import detect_condition

OCR_MIN_CONF = 70.0  # mean Tesseract word confidence below this forces review


def doc_type(filename: str) -> str:
    name = filename.lower()
    if name.startswith("bill"):
        return "bill"
    if "discharge" in name:
        return "discharge_summary"
    if "receipt" in name:
        return "receipt"
    if "prescription" in name:
        return "prescription"
    return "other"


def read_documents(files: dict[str, bytes], deny_names: list[str] | None = None,
                   conditions_cfg: dict | None = None, claim_id: str | None = None,
                   use_llm: bool = True) -> dict:
    """files: {filename: pdf bytes}. Returns bills, discharge, receipts, doc_flags, review_reasons,
    and `pii` (placeholder -> value) for the vault. Parsing runs on the local text; anything that may
    later leave the machine (other_text, LLM inputs) is masked. The discharge summary keeps only a
    condition code and the eye, never the diagnosis text."""
    bills, receipts, discharge = [], [], None
    pii: dict[str, str] = {}
    llm_used: list[str] = []
    other_text: list[str] = []  # masked non-line text from every document
    doc_flags: list[str] = []
    review: list[str] = []
    reads = {}
    for name in sorted(files):
        kind = doc_type(name)
        if kind == "prescription" or kind == "other":
            continue
        r = read_pdf_bytes(files[name])
        masked = mask(r.text, deny_names)
        pii.update(masked.mapping)
        if kind != "bill":
            other_text += [ln.strip() for ln in masked.text.splitlines() if ln.strip()]
        reads[name] = {"sha256": r.sha256, "mode": r.mode, "mean_conf": r.mean_conf}
        if r.mode == "ocr" and (r.mean_conf or 0) < OCR_MIN_CONF:
            review.append(f"LOW_CONFIDENCE: {name} read at {r.mean_conf}")
        if kind == "bill":
            b = parse_bill(r.text, name)
            b["other_text"] = parse_bill(masked.text, name)["other_text"]
            other_text += b["other_text"]
            for l in b["lines"]:
                l["category"], l["confidence"], l["method"] = classify(l["description"])
            if b["problems"]:
                review.append(f"LOW_CONFIDENCE: {name}: " + "; ".join(b["problems"]))
            if not b["lines"] or not b["bill_no"]:
                review.append(f"LOW_CONFIDENCE: {name}: could not read bill lines")
            bills.append(b)
        elif kind == "discharge_summary":
            discharge = parse_discharge(r.text, name)
            if conditions_cfg:
                discharge["condition"] = detect_condition(discharge, conditions_cfg)
                discharge["condition_method"] = "keyword"
                if use_llm and discharge["condition"] == "other" and discharge.get("procedure"):
                    try:  # a surgical stay the keywords did not recognise
                        got = llm.map_condition(discharge.get("diagnosis"), discharge.get("procedure"), claim_id)
                        llm_used.append("condition_map")
                        if got["confidence"] >= llm.CONFIDENCE_MIN:
                            discharge["condition"], discharge["condition_method"] = got["condition"], "llm"
                            if got["eye"] != "none" and not discharge.get("eye"):
                                discharge["eye"] = got["eye"]
                        elif got["condition"] != "other":
                            review.append("LOW_CONFIDENCE: condition unclear from the discharge summary")
                    except LLMUnavailable:
                        pass
                discharge.pop("diagnosis", None)
                discharge.pop("procedure", None)
        elif kind == "receipt":
            receipts.append(parse_receipt(r.text, name))
    # Lines the keywords did not recognise: ask the LLM (masked descriptions only).
    unknown = [l for b in bills for l in b["lines"] if l["category"] is None]
    if unknown and use_llm:
        try:
            labels = llm.classify_lines([mask(l["description"], deny_names).text for l in unknown], claim_id)
            llm_used.append("classify_lines")
            for l, got in zip(unknown, labels):
                if got["category"]:
                    l["category"], l["confidence"], l["method"] = got["category"], got["confidence"], "llm"
        except LLMUnavailable:
            pass
    for b in bills:
        for l in b["lines"]:
            if l["category"] is None:
                review.append(f"LOW_CONFIDENCE: {b['file']} line {l['line_no']} could not be classified")
            elif l["confidence"] < llm.CONFIDENCE_MIN:
                review.append(f"LOW_CONFIDENCE: {b['file']} line {l['line_no']} classified with low confidence")

    # Instructions inside documents: documents are data; a hit only adds a flag.
    hits, soft = find_instructions(other_text), suspicious_lines(other_text)
    if hits or soft:
        verdict = None
        if use_llm:
            try:
                verdict = llm.confirm_instruction(sorted(set(hits + soft)), claim_id)
                llm_used.append("instruction_check")
            except LLMUnavailable:
                verdict = None
        if verdict is None:
            flagged = bool(hits)  # no LLM: trust the strict patterns only
        elif hits:
            flagged = not (not verdict["is_instruction"] and verdict["confidence"] >= llm.CONFIDENCE_MIN)
        else:
            flagged = verdict["is_instruction"] and verdict["confidence"] >= llm.CONFIDENCE_MIN
        if flagged:
            doc_flags.append("INSTRUCTION_IN_DOCUMENT")

    return {
        "bills": bills,
        "discharge": discharge,
        "receipts": receipts,
        "reads": reads,
        "doc_flags": sorted(set(doc_flags)),
        "review_reasons": review,
        "pii": pii,
        "llm_used": llm_used,
    }
