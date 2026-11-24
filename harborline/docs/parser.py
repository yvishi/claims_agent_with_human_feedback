"""Parse step (code only): bill / discharge summary / receipt text -> structured data with evidence.

Tolerant of the OCR noise seen in the pack: "1 5-Sep-26", "Rs.600.00_", "Roomcharges".
"""
from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal

MONEY = r"Rs\.?\s*([\d,]+\.\d{2})"
LINE_RE = re.compile(
    r"^\s*(\d{1,2})[.\s]+(.+?)\s+(\d{1,4})[.,]?[\s_|]+" + MONEY + r"[^\sR]*[\s_|]+" + MONEY + r"\S*\s*$"
)
DATE_RE = r"(\d\s?\d?)\s*-\s*([A-Za-z]{3})\s*-\s*(\d\s?\d)"
NET_RE = re.compile(r"NET\s+AMOUNT\s+PAYABLE\s*:?\s*" + MONEY, re.I)
HEADER_RE = re.compile(r"S\.?\s?No\b.*Description", re.I)


def money(s: str) -> Decimal:
    return Decimal(s.replace(",", ""))


def normalise_bill_no(raw: str) -> str:
    """Remove spaces and fix OCR's letter O for zero inside a code ("HO5/..." -> "H05/...")."""
    s = re.sub(r"\s", "", raw).upper()
    return re.sub(r"(?<=[A-Z])O(?=\d)", "0", s)


def parse_date(raw: str | None) -> date | None:
    if not raw:
        return None
    m = re.search(DATE_RE, raw)
    if not m:
        return None
    d, mon, y = (g.replace(" ", "") for g in m.groups())
    try:
        return datetime.strptime(f"{int(d):02d}-{mon.title()}-{y}", "%d-%b-%y").date()
    except ValueError:
        return None


def _field_date(text: str, label: str) -> date | None:
    m = re.search(label + r"\s*:?\s*" + DATE_RE, text, re.I)
    return parse_date(m.group(0)) if m else None


def parse_bill(text: str, file: str) -> dict:
    kind = "pharmacy" if re.search(r"PHARMACY\s+BILL", text, re.I) else "hospital"
    bill_no = re.search(r"Bill\s*No\s*:?\s*([A-Z0-9]+(?:\s?/\s?[A-Z0-9]+)+)", text, re.I)
    net = NET_RE.search(text)
    lines, other_text, problems = [], [], []
    for src_line_no, raw in enumerate(text.splitlines(), 1):
        m = LINE_RE.match(raw)
        if m:
            sno, desc, qty, rate, amount = m.groups()
            qty_i, rate_d, amount_d = int(qty), money(rate), money(amount)
            if (rate_d * qty_i).quantize(Decimal("0.01")) != amount_d:
                problems.append(f"line {sno}: qty x rate != amount")
            lines.append({
                "line_no": int(sno),
                "description": re.sub(r"\s+", " ", desc).strip(),
                "qty": qty_i,
                "rate": str(rate_d),
                "amount": str(amount_d),
                "evidence": {"file": file, "source_line": src_line_no, "text": raw.strip()},
            })
        elif raw.strip() and not HEADER_RE.search(raw):
            other_text.append(raw.strip())
    lines_sum = sum((Decimal(l["amount"]) for l in lines), Decimal("0"))
    stated = money(net.group(1)) if net else None
    return {
        "file": file,
        "kind": kind,
        "bill_no": normalise_bill_no(bill_no.group(1)) if bill_no else None,
        "bill_date": _iso(_field_date(text, r"Bill\s*Date")),
        "admitted": _iso(_field_date(text, r"Admitted")),
        "discharged": _iso(_field_date(text, r"Discharged")),
        "lines": lines,
        "lines_sum": str(lines_sum),
        "stated_total": str(stated) if stated is not None else None,
        "other_text": other_text,
        "problems": problems,
    }


def parse_discharge(text: str, file: str) -> dict:
    diag = re.search(r"Final\s+diagnosis\s*:?\s*(.+)", text, re.I)
    proc = re.search(r"Procedure\s*:?\s*(.+)", text, re.I)
    blob = text.lower()
    eye = None
    if re.search(r"both\s+eyes|bilateral", blob):
        eye = "both"
    elif "left eye" in blob:
        eye = "left"
    elif "right eye" in blob:
        eye = "right"
    return {
        "file": file,
        "admitted": _iso(_field_date(text, r"Date\s+of\s+admission")),
        "discharged": _iso(_field_date(text, r"Date\s+of\s+discharge")),
        "diagnosis": diag.group(1).strip() if diag else None,
        "procedure": proc.group(1).strip() if proc else None,
        "eye": eye,
    }


def parse_receipt(text: str, file: str) -> dict:
    amt = re.search(r"Amount\s*:?\s*" + MONEY, text, re.I)
    bills = re.search(r"Against\s+bill\(?s?\)?\s*:?\s*(.+)", text, re.I)
    return {
        "file": file,
        "amount": str(money(amt.group(1))) if amt else None,
        "bills": [re.sub(r"\s", "", b) for b in bills.group(1).split(",")] if bills else [],
    }


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None
