"""Bill reader agent: claim documents -> structured, classified facts.

Read (local text/OCR) -> parse (code) -> classify (keywords; LLM for leftovers in iteration 2)
-> instruction check. Iteration 1 has no masking yet: nothing here leaves the machine.
"""
from __future__ import annotations

from harborline.docs.classify import classify
from harborline.docs.instructions import find_instructions
from harborline.docs.parser import parse_bill, parse_discharge, parse_receipt
from harborline.docs.reader import read_pdf_bytes

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


def read_documents(files: dict[str, bytes]) -> dict:
    """files: {filename: pdf bytes}. Returns bills, discharge, receipts, doc_flags, review_reasons."""
    bills, receipts, discharge = [], [], None
    doc_flags: list[str] = []
    review: list[str] = []
    reads = {}
    for name in sorted(files):
        kind = doc_type(name)
        if kind == "prescription" or kind == "other":
            continue
        r = read_pdf_bytes(files[name])
        reads[name] = {"sha256": r.sha256, "mode": r.mode, "mean_conf": r.mean_conf}
        if r.mode == "ocr" and (r.mean_conf or 0) < OCR_MIN_CONF:
            review.append(f"LOW_CONFIDENCE: {name} read at {r.mean_conf}")
        if kind == "bill":
            b = parse_bill(r.text, name)
            for l in b["lines"]:
                l["category"], l["confidence"], l["method"] = classify(l["description"])
            if b["problems"]:
                review.append(f"LOW_CONFIDENCE: {name}: " + "; ".join(b["problems"]))
            if not b["lines"] or not b["bill_no"]:
                review.append(f"LOW_CONFIDENCE: {name}: could not read bill lines")
            if find_instructions(b["other_text"]):
                doc_flags.append("INSTRUCTION_IN_DOCUMENT")
            bills.append(b)
        elif kind == "discharge_summary":
            discharge = parse_discharge(r.text, name)
        elif kind == "receipt":
            receipts.append(parse_receipt(r.text, name))
    return {
        "bills": bills,
        "discharge": discharge,
        "receipts": receipts,
        "reads": reads,
        "doc_flags": sorted(set(doc_flags)),
        "review_reasons": review,
    }
