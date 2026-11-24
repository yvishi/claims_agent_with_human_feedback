"""Intake agent: document checklist (Harborline page)."""
from __future__ import annotations

from harborline.agents.bill_reader import doc_type


def missing_documents(filenames: list[str], has_pharmacy_bill: bool | None = None) -> list[str]:
    """Return the missing doc types. Claim form is the claim record itself, so always present.

    Prescription is required only when pharmacy items are claimed on a separate pharmacy bill
    (C-01 has an in-patient medicines line and needs no prescription; C-20 has a pharmacy bill).
    Until bills are read, a second bill file is taken as the pharmacy bill.
    """
    types = [doc_type(f) for f in filenames]
    missing = []
    if "bill" not in types:
        missing.append("final_bill")
    if "discharge_summary" not in types:
        missing.append("discharge_summary")
    if "receipt" not in types:
        missing.append("receipt")
    pharmacy = has_pharmacy_bill if has_pharmacy_bill is not None else types.count("bill") > 1
    if pharmacy and "prescription" not in types:
        missing.append("prescription")
    return missing
