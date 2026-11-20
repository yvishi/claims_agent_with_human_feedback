"""Local PII masking (Presidio + spaCy, all on this machine). Adapted from our week-2 masker.

Kept from week 2: Presidio with local spaCy NER for PERSON, label-anchored recognizers that mask
only the value after a label, value propagation (a name found once is masked everywhere it
appears), and Presidio's loggers pinned so document text never reaches a log.
New for claims: Indian phone, bank account, IFSC, GSTIN, email, and a deny-list built from every
member name the policy service knows.

mask(text, deny_names) -> Masked(text, mapping) where mapping is {"<PERSON_1>": "Ravi Kulkarni"}.
The mapping goes to the encrypted vault; only the masked text may leave the machine.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field

from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_analyzer.predefined_recognizers import SpacyRecognizer

for _name in ("presidio-analyzer", "presidio-anonymizer", "decision_process"):
    _lg = logging.getLogger(_name)
    _lg.setLevel(logging.WARNING)
    _lg.propagate = False

SPACY_MODEL = "en_core_web_lg"
SCORE_THRESHOLD = 0.5

PERSON, PHONE, ACCOUNT, IFSC, GSTIN, EMAIL, DOB = (
    "PERSON", "PHONE", "BANK_ACCOUNT", "IFSC", "GSTIN", "EMAIL", "DOB")

# Values after these labels are personal; the label itself stays.
_LABELS = {
    PERSON: r"(?:Patient(?:\s+name)?|Received\s+from|Member(?:\s+name)?|Name|Payee|Insured|Dear)",
    DOB: r"(?:DOB|Date\s+of\s+birth)",
}
_STOP = r"(?=\s{2,}|\s+(?:Age|Sex|Phone|DOB|Gender|Amount|Mode)\b|[,\n]|$)"

# Words NER may tag as names that are really medical / billing terms.
_NOT_NAMES = {
    "room", "nursing", "consultant", "medicines", "gloves", "masks", "icu", "ot", "iol", "tab", "inj",
    "syp", "paracetamol", "pantoprazole", "ceftriaxone", "lactulose", "ondansetron", "phacoemulsification",
    "dengue", "pneumonia", "cataract", "hernia", "laparoscopic", "authorised", "signatory", "billing",
    "department", "net", "amount", "payable", "rs", "upi", "neft", "discharge", "summary", "final", "bill",
}

_analyzer: AnalyzerEngine | None = None
_lock = threading.Lock()


@dataclass
class Masked:
    text: str
    mapping: dict[str, str] = field(default_factory=dict)


def _recognizers() -> list[PatternRecognizer]:
    return [
        PatternRecognizer(supported_entity=PHONE, name="InPhone", patterns=[
            Pattern("in_mobile", r"(?<![\w+])(?:\+?91[ \-]?)?[6-9]\d{4}[ \-]?\d{5}(?!\d)", 0.7)],
            context=["phone", "mobile", "tel", "contact"]),
        PatternRecognizer(supported_entity=ACCOUNT, name="BankAccount", patterns=[
            Pattern("acct", r"(?<!\d)\d{9,18}(?!\d)", 0.3)],
            context=["account", "a/c", "acct", "bank"]),
        PatternRecognizer(supported_entity=IFSC, name="Ifsc", patterns=[
            Pattern("ifsc", r"(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])", 0.85)]),
        PatternRecognizer(supported_entity=GSTIN, name="Gstin", patterns=[
            Pattern("gstin", r"(?<![A-Z0-9])\d{2}[A-Z0-9]{5}\s?\d{2}[A-Z0-9]{2}\d?[A-Z0-9]Z[A-Z0-9](?![A-Z0-9])", 0.6)]),
        PatternRecognizer(supported_entity=EMAIL, name="Email", patterns=[
            Pattern("email", r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}", 0.9)]),
    ]


def get_analyzer() -> AnalyzerEngine:
    global _analyzer
    if _analyzer is None:
        with _lock:
            if _analyzer is None:
                nlp = NlpEngineProvider(nlp_configuration={
                    "nlp_engine_name": "spacy",
                    "models": [{"lang_code": "en", "model_name": SPACY_MODEL}],
                    "ner_model_configuration": {
                        "model_to_presidio_entity_mapping": {"PERSON": PERSON, "PER": PERSON},
                        "labels_to_ignore": ["ORG", "GPE", "LOC", "FAC", "NORP", "DATE", "TIME", "CARDINAL",
                                             "ORDINAL", "PERCENT", "MONEY", "QUANTITY", "EVENT", "PRODUCT",
                                             "WORK_OF_ART", "LAW", "LANGUAGE", "MISC"],
                        "low_score_entity_names": [],
                    },
                }).create_engine()
                reg = RecognizerRegistry(supported_languages=["en"])
                reg.add_recognizer(SpacyRecognizer(supported_language="en", supported_entities=[PERSON]))
                for r in _recognizers():
                    reg.add_recognizer(r)
                _analyzer = AnalyzerEngine(registry=reg, nlp_engine=nlp, supported_languages=["en"],
                                           default_score_threshold=SCORE_THRESHOLD)
    return _analyzer


def _label_spans(text: str) -> list[tuple[int, int, str]]:
    spans = []
    for ent, label in _LABELS.items():
        for m in re.finditer(label + r"\s*[:,]?\s*(?P<v>[A-Za-z0-9][A-Za-z0-9.'\- ]*?)" + _STOP, text, re.I | re.M):
            if m.group("v").strip():
                spans.append((m.start("v"), m.end("v"), ent))
    return spans


def _deny_spans(text: str, names: list[str]) -> list[tuple[int, int, str]]:
    spans = []
    for name in names:
        parts = [re.escape(p) for p in name.split() if len(p) > 1]
        if not parts:
            continue
        for m in re.finditer(r"(?<!\w)" + r"\s+".join(parts) + r"(?!\w)", text, re.I):
            spans.append((m.start(), m.end(), PERSON))
    return spans


def _is_medical(value: str) -> bool:
    words = re.findall(r"[a-z]+", value.lower())
    return bool(words) and all(w in _NOT_NAMES for w in words)


def mask(text: str, deny_names: list[str] | None = None) -> Masked:
    if not text:
        return Masked(text or "")
    spans = _label_spans(text) + _deny_spans(text, deny_names or [])
    for r in get_analyzer().analyze(text=text, language="en"):
        start, end = r.start, r.end
        if r.entity_type == PERSON:
            value = text[start:end]
            # NER sometimes runs into the next field ("Ravi Kulkarni   Age"): cut at the field word
            cut = re.search(r"\s+(?:Age|Sex|Phone|DOB|Gender|Bill)\b", value)
            if cut:
                end = start + cut.start()
                value = text[start:end]
            if "\n" in value or re.search(r"\d|/", value) or _is_medical(value) or not value.strip():
                continue
        spans.append((start, end, r.entity_type))
    # propagate: every other occurrence of a found name / id is masked too
    for s, e, ent in list(spans):
        value = text[s:e].strip()
        if len(value) >= 3:
            for m in re.finditer(r"(?<!\w)" + re.escape(value) + r"(?!\w)", text, re.I):
                spans.append((m.start(), m.end(), ent))
    # resolve overlaps: earliest start, then longest
    spans.sort(key=lambda x: (x[0], -(x[1] - x[0])))
    merged: list[tuple[int, int, str]] = []
    for s, e, ent in spans:
        if merged and s < merged[-1][1]:
            ps, pe, pent = merged[-1]
            merged[-1] = (ps, max(pe, e), pent)
        else:
            merged.append((s, e, ent))
    out, mapping, by_value, last = [], {}, {}, 0
    counters: dict[str, int] = {}
    for s, e, ent in merged:
        value = text[s:e]
        key = (ent, re.sub(r"\s+", " ", value).strip().lower())
        if key not in by_value:
            counters[ent] = counters.get(ent, 0) + 1
            by_value[key] = f"<{ent}_{counters[ent]}>"
            mapping[by_value[key]] = value
        out.append(text[last:s])
        out.append(by_value[key])
        last = e
    out.append(text[last:])
    return Masked("".join(out), mapping)
