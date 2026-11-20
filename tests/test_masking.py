"""Leak test: every PDF in the claim pack, masked, must contain no member name, phone, bank account
or IFSC. Prints only file names, never values."""
from __future__ import annotations

import json
import re

import pytest

from harborline.config import get_settings
from harborline.docs.reader import read_pdf
from harborline.privacy.masker import mask

ROOT = get_settings().claim_pack_dir
pytestmark = pytest.mark.skipif(not (ROOT / "data" / "members.json").exists(), reason="claim pack not found")


def _members():
    return json.loads((ROOT / "data" / "members.json").read_text())


def test_no_member_pii_survives_masking():
    members = _members()
    names = [m["name"] for m in members]
    secrets = set()
    for m in members:
        secrets |= {m["name"].lower(), m["phone"], m["bank"]["account_no"], m["bank"]["ifsc"].lower()}
        secrets |= {p.lower() for p in m["name"].split()}
    pdfs = sorted(list((ROOT / "claims").glob("*/*.pdf")) + list((ROOT / "harness" / "late_documents").glob("*/*.pdf")))
    leaked = []
    for p in pdfs:
        low = mask(read_pdf(p).text, names).text.lower()
        if any(re.search(r"(?<!\w)" + re.escape(s) + r"(?!\w)", low) for s in secrets):
            leaked.append(f"{p.parent.name}/{p.name}")
    assert not leaked, leaked


def test_bill_lines_and_numbers_survive_masking():
    text = read_pdf(ROOT / "claims" / "CLM-2026-10448" / "bill-1.pdf").text
    m = mask(text, [x["name"] for x in _members()])
    for keep in ("H08/2608/2887", "Room charges - Private room", "Rs. 24,000.00", "Age/Sex: 38/M", "Gloves"):
        assert keep in m.text
    assert "<PERSON_1>" in m.text and "<PHONE_1>" in m.text


def test_same_value_same_placeholder():
    m = mask("Patient: Ravi Kulkarni\nReceived from: Ravi Kulkarni", ["Ravi Kulkarni"])
    assert m.text.count("<PERSON_1>") == 2 and len(m.mapping) == 1
