"""Adjudicator: one pure function, no I/O. Computes every rupee with Decimal.

adjudicate(facts, cfg) -> draft

`facts` is a plain dict (JSON-safe, masked data only):
  claim       claim form fields: claim_id, cause, admission_date, discharge_date, filed_on,
              claimed_amount_inr, hospital_id
  bills       parsed bills; each line has category (one of ten) and amount
  discharge   parsed discharge summary (dates, diagnosis, procedure, eye) or None
  policy      status, period_start, period_end, inception_date, sum_insured_inr
  member_dob  ISO date
  remaining   sum insured left this policy year (string)
  hospital    {"watch_list": bool}
  duplicates  other claims sharing a (hospital_id, bill_no): [{claim_id, filed_on, settled}]
  doc_flags   flags raised while reading documents, e.g. INSTRUCTION_IN_DOCUMENT
  review_reasons  internal reasons that force review but are not graded flags (LOW_CONFIDENCE ...)

Order (assignment): eligibility -> flags -> non-payable -> proportionate room deduction ->
sub-limit -> co-pay -> remaining sum insured, rounding to paise after every step.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

import yaml

from harborline.money import D, ZERO, inr, r2


@lru_cache
def load_rules(path: str) -> dict:
    return yaml.safe_load(Path(path).read_text())


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def _add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(y, m, day)
        except ValueError:
            continue
    raise ValueError(d)


def age_on(dob: date, on: date) -> int:
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


def detect_condition(discharge: dict | None, cfg: dict) -> str:
    if not discharge:
        return "other"
    text = " ".join(filter(None, [discharge.get("diagnosis"), discharge.get("procedure")])).lower()
    for cond, words in cfg["conditions"].items():
        if any(w in text for w in words):
            return cond
    return "other"


def is_duplicate(claim: dict, duplicates: list[dict]) -> bool:
    """Order-independent: duplicate if any other claim with the bill is settled or filed earlier."""
    me = (claim["filed_on"], claim["claim_id"])
    for other in duplicates:
        if other["claim_id"] == claim["claim_id"]:
            continue
        if other.get("settled") or (other["filed_on"], other["claim_id"]) < me:
            return True
    return False


def adjudicate(facts: dict, cfg: dict) -> dict:
    claim, policy = facts["claim"], facts["policy"]
    admission = _d(claim["admission_date"])
    discharge_dt = _d(claim["discharge_date"])
    claimed = r2(D(str(claim["claimed_amount_inr"])))
    discharge = facts.get("discharge")
    condition = detect_condition(discharge, cfg)

    flags: list[str] = []
    reject_code: str | None = None
    notes: list[str] = []

    # ---- Stage A: eligibility -------------------------------------------------------------
    start, end = _d(policy["period_start"]), _d(policy["period_end"])
    if policy["status"] != "active" or not (start <= admission <= end):
        reject_code = reject_code or "POLICY_INACTIVE"
        notes.append(f"Policy not active on admission date {admission} "
                     f"(status {policy['status']}, period {start} to {end}).")

    inception = _d(policy["inception_date"])
    cause = (claim.get("cause") or "illness").lower()  # missing cause is treated as illness
    if cause != "accident" and admission < inception + timedelta(days=cfg["initial_wait_days"]):
        reject_code = reject_code or "WAITING_PERIOD"
        flags.append("WAITING_PERIOD")
        notes.append(f"Illness within the first {cfg['initial_wait_days']} days of the policy "
                     f"(inception {inception}).")
    if condition in cfg["specific_wait_conditions"]:
        wait_end = _add_months(inception, cfg["specific_wait_months"])
        if admission < wait_end:
            reject_code = reject_code or "WAITING_PERIOD"
            if "WAITING_PERIOD" not in flags:
                flags.append("WAITING_PERIOD")
            notes.append(f"{condition.replace('_', ' ').title()} has a {cfg['specific_wait_months']}-month "
                         f"waiting period from {inception}; it ends on {wait_end}.")

    if is_duplicate(claim, facts.get("duplicates") or []):
        reject_code = reject_code or "DUPLICATE"
        flags.append("DUPLICATE")
        notes.append("A bill on this claim (same hospital and bill number) was already claimed.")

    # ---- Stage B: review-only flags -------------------------------------------------------
    if discharge_dt and (_d(claim["filed_on"]) - discharge_dt).days > cfg["late_filing_days"]:
        flags.append("LATE_FILING")
    if (facts.get("hospital") or {}).get("watch_list"):
        flags.append("WATCHLIST_HOSPITAL")
    if discharge:
        for b in facts["bills"]:
            for key in ("admitted", "discharged"):
                if b.get(key) and discharge.get(key) and b[key] != discharge[key]:
                    if "DATE_MISMATCH" not in flags:
                        flags.append("DATE_MISMATCH")
    for b in facts["bills"]:
        if b.get("stated_total") is not None and D(b["stated_total"]) != D(b["lines_sum"]):
            if "BILL_TOTAL_MISMATCH" not in flags:
                flags.append("BILL_TOTAL_MISMATCH")
    for f in facts.get("doc_flags") or []:
        if f not in flags:
            flags.append(f)
    review_reasons = list(facts.get("review_reasons") or [])

    # ---- Stage C: calculation ---------------------------------------------------------------
    sum_insured = D(str(policy["sum_insured_inr"]))
    lines = [dict(l, bill_no=b["bill_no"]) for b in facts["bills"] for l in b["lines"]]
    for l in lines:
        l["billed"] = r2(D(l["amount"]))
        l["payable"] = l["billed"]
        l["deduction_code"] = None
        if l.get("category") is None:
            review_reasons.append(f"Unclassified line: {l['bill_no']} #{l['line_no']}")

    deductions: list[dict] = []

    # Step 1: non-payable (P7)
    np_lines = [l for l in lines if l.get("category") == "non_payable"]
    if np_lines:
        for l in np_lines:
            l["payable"], l["deduction_code"] = ZERO, "NON_PAYABLE"
        amt = r2(sum((l["billed"] for l in np_lines), ZERO))
        deductions.append({
            "code": "NON_PAYABLE", "amount_inr": amt, "lines": [l["line_no"] for l in np_lines],
            "why": ", ".join(l["description"] for l in np_lines) + " are not payable under the policy.",
        })

    # Step 2: proportionate room deduction (P4), room and ICU handled separately
    caps = {"room": r2(sum_insured * D(cfg["room_cap_pct"])), "icu": r2(sum_insured * D(cfg["icu_cap_pct"]))}
    stays = []  # (kind, days, ratio)
    why_parts = []
    affected: list[dict] = []
    for kind in ("room", "icu"):
        for l in [x for x in lines if x.get("category") == kind]:
            days = int(l["qty"]) or 1
            rate = l["billed"] / days
            ratio = Decimal(1)
            if rate > caps[kind]:
                ratio = caps[kind] / rate
                l["payable"] = r2(caps[kind] * days)
                l["deduction_code"] = "ROOM_RENT_PROPORTIONATE"
                affected.append(l)
                label = "ICU" if kind == "icu" else "Room rent"
                pct = "2%" if kind == "icu" else "1%"
                why_parts.append(f"{label} {inr(rate)}/day against a cap of {inr(caps[kind])}/day "
                                 f"({pct} of {inr(sum_insured)}).")
            stays.append((kind, days, ratio))
    total_days = sum(s[1] for s in stays)
    if total_days and any(s[2] != 1 for s in stays):
        factor = sum((D(days) / D(total_days)) * ratio for _, days, ratio in stays)
        for l in lines:
            if l.get("category") in cfg["proportionate_categories"]:
                new = r2(l["billed"] * factor)
                if new != l["payable"]:
                    l["payable"], l["deduction_code"] = new, "ROOM_RENT_PROPORTIONATE"
                    affected.append(l)
        if len(stays) > 1:
            notes.append("Mixed ward/ICU stay: nursing, doctor and procedure charges split by days.")
    if affected:
        amt = r2(sum((l["billed"] - l["payable"] for l in affected), ZERO))
        why_parts.append("Nursing, doctor's fees and procedure charges are paid in the same proportion. "
                         "Medicines, consumables, implants and diagnostics are not reduced.")
        deductions.append({
            "code": "ROOM_RENT_PROPORTIONATE", "amount_inr": amt,
            "lines": sorted({l["line_no"] for l in affected}), "why": " ".join(why_parts),
        })

    running = r2(sum((l["payable"] for l in lines), ZERO))

    # Step 3: sub-limit (P6)
    if condition in cfg["sub_limits"]:
        eyes = 2 if (discharge or {}).get("eye") == "both" else 1
        if condition == "cataract" and not (discharge or {}).get("eye"):
            review_reasons.append("Cataract: eye not stated in the discharge summary")
        cap = r2(D(cfg["sub_limits"][condition]) * eyes)
        if running > cap:
            amt = r2(running - cap)
            deductions.append({"code": "SUB_LIMIT", "amount_inr": amt, "lines": [],
                               "why": f"Cataract surgery is limited to {inr(cap)} "
                                      f"({inr(D(cfg['sub_limits'][condition]))} per eye)."})
            running = cap

    # Step 4: co-pay (P5)
    age = age_on(_d(facts["member_dob"]), admission)
    if age >= cfg["copay_age"]:
        amt = r2(running * D(cfg["copay_pct"]))
        if amt > 0:
            deductions.append({"code": "CO_PAY", "amount_inr": amt, "lines": [],
                               "why": f"Members aged {cfg['copay_age']} or over pay "
                                      f"{int(D(cfg['copay_pct']) * 100)}% of the payable amount "
                                      f"(age {age} on admission)."})
            running = r2(running - amt)

    # Step 5: remaining sum insured (P8)
    remaining = r2(D(facts["remaining"]))
    if running > remaining:
        amt = r2(running - remaining)
        deductions.append({"code": "BALANCE_CAP", "amount_inr": amt, "lines": [],
                           "why": f"Only {inr(remaining)} of the sum insured is left for this policy year."})
        running = remaining

    # ---- Stage D: decision and route ------------------------------------------------------
    if reject_code:
        decision, payable, out_deductions = "reject", ZERO, []
    else:
        payable = running
        decision = "approve" if payable == claimed else "partial"
        out_deductions = deductions

    if decision == "reject":
        route = "processor"  # the agent never rejects on its own
    elif payable > D(cfg["reviewer_above"]):
        route = "processor_and_reviewer"
    elif flags or review_reasons or payable > D(cfg["auto_approve_max"]):
        route = "processor"
    else:
        route = "auto"

    return {
        "claim_id": claim["claim_id"],
        "decision": decision,
        "reject_code": reject_code,
        "claimed_inr": str(claimed),
        "payable_inr": str(payable),
        "deductions": [dict(d, amount_inr=str(d["amount_inr"])) for d in out_deductions],
        "flags": flags,
        "review_reasons": review_reasons,
        "route": route,
        "condition": condition,
        "age": age,
        "notes": notes,
        "line_items": [
            {"bill_no": l["bill_no"], "line_no": l["line_no"], "description": l["description"],
             "category": l.get("category"), "billed_inr": str(l["billed"]),
             "payable_after_step2_inr": str(l["payable"]), "deduction_code": l["deduction_code"],
             "evidence": l.get("evidence")}
            for l in lines
        ],
        "rules_version": cfg["version"],
    }
