"""Classify step: line description -> one of ten categories, keywords first.

Matching runs on lowercase text with spaces removed, so OCR joins like "Roomcharges" still match.
Order matters: non-payable first, then the more specific categories. Unmatched lines return
category None; iteration 2 sends those (masked) to the LLM, iteration 1 marks them needs_review.
"""
from __future__ import annotations

CATEGORIES = (
    "room", "icu", "nursing", "doctor_fee", "procedure", "implants",
    "diagnostics", "consumables", "medicines", "non_payable",
)

# (category, keywords) in priority order. Keywords are compared with spaces removed.
KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("non_payable", ("registration", "admissionkit", "gloves", "mask", "attendant", "food",
                     "toiletr", "telephone", "documentation")),
    ("icu", ("icu", "intensivecare", "criticalcare", "iccu")),
    ("implants", ("implant", "intraocularlens", "iol", "stent", "plateandscrew", "prosthe", "screws")),
    ("room", ("roomcharge", "roomrent", "wardcharge", "bedcharge", "room")),
    ("nursing", ("nursing",)),
    ("doctor_fee", ("consultant", "consultation", "doctor", "visit")),
    ("diagnostics", ("laboratory", "investigation", "x-ray", "xray", "imaging", "scan", "mri",
                     "ecg", "ultrasound", "pathology", "radiology")),
    ("consumables", ("consumable", "syringe", "dressing", "ivset")),
    ("procedure", ("surgery", "operation", "theatre", "anaesthe", "anesthe", "procedure", "repair",
                   "replacement", "angioplasty", "appendicectomy", "phaco", "reduction", "fixation",
                   "laparoscop", "endoscop", "ectomy", "plasty")),
    ("medicines", ("medicine", "pharmacy", "tab.", "inj.", "syp.", "cap.", "tablet", "injection",
                   "syrup", "capsule", "drug")),
]


def classify(description: str) -> tuple[str | None, float, str]:
    """Return (category, confidence, method)."""
    key = description.lower().replace(" ", "")
    for category, words in KEYWORDS:
        if any(w in key for w in words):
            return category, 1.0, "keyword"
    return None, 0.0, "none"
