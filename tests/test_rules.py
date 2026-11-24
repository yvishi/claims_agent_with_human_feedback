"""Rules engine tests from hand-fed lines (no PDFs, no services)."""
from __future__ import annotations

from decimal import Decimal

import pytest

from harborline.config import get_settings
from harborline.rules.engine import adjudicate, is_duplicate, load_rules

CFG = load_rules(str(get_settings().rules_file))


def L(n, desc, cat, amount, qty=1):
    return {"line_no": n, "description": desc, "category": cat, "qty": qty, "amount": str(amount)}


def facts(lines, *, claimed, sum_insured=400000, dob="1988-04-13", remaining=None, cause="illness",
          admission="2026-08-27", discharge="2026-08-31", filed="2026-09-10", inception="2021-01-01",
          status="active", diagnosis=None, procedure=None, eye=None, dups=None, flags=None):
    total = sum(Decimal(str(l["amount"])) for l in lines)
    return {
        "claim": {"claim_id": "CLM-T", "cause": cause, "admission_date": admission,
                  "discharge_date": discharge, "filed_on": filed, "claimed_amount_inr": claimed,
                  "hospital_id": "H01"},
        "bills": [{"bill_no": "B1", "lines": lines, "lines_sum": str(total), "stated_total": str(total),
                   "admitted": admission, "discharged": discharge}],
        "discharge": {"admitted": admission, "discharged": discharge, "diagnosis": diagnosis,
                      "procedure": procedure, "eye": eye},
        "policy": {"status": status, "period_start": "2026-01-01", "period_end": "2026-12-31",
                   "inception_date": inception, "sum_insured_inr": sum_insured},
        "member_dob": dob,
        "remaining": str(remaining if remaining is not None else sum_insured),
        "hospital": {"watch_list": False},
        "duplicates": dups or [],
        "doc_flags": flags or [],
        "review_reasons": [],
    }


def codes(draft):
    return {d["code"]: Decimal(d["amount_inr"]) for d in draft["deductions"]}


def test_c01_clean_auto():
    lines = [L(1, "Room", "room", 3600, 2), L(2, "Nursing", "nursing", 1200, 2),
             L(3, "Consultant visits", "doctor_fee", 2800, 4), L(4, "Lab", "diagnostics", 2400),
             L(5, "Consumables", "consumables", 600), L(6, "Medicines", "medicines", 7800)]
    d = adjudicate(facts(lines, claimed=18400, sum_insured=500000, dob="2001-09-17"), CFG)
    assert (d["decision"], d["payable_inr"], d["route"], d["deductions"]) == ("approve", "18400.00", "auto", [])


def test_c02_room_above_cap():
    lines = [L(1, "Room", "room", 24000, 4), L(2, "Nursing", "nursing", 4000, 4),
             L(3, "Consultant", "doctor_fee", 5600, 8), L(4, "Lab", "diagnostics", 2400),
             L(5, "X-ray", "diagnostics", 2800), L(6, "Consumables", "consumables", 4200),
             L(7, "Medicines", "medicines", 3200), L(8, "Admission kit", "non_payable", 1200),
             L(9, "Gloves", "non_payable", 640)]
    d = adjudicate(facts(lines, claimed=48040), CFG)
    assert d["payable_inr"] == "35000.00" and d["decision"] == "partial" and d["route"] == "processor"
    assert codes(d) == {"NON_PAYABLE": Decimal("1840.00"), "ROOM_RENT_PROPORTIONATE": Decimal("11200.00")}
    by_line = {l["line_no"]: l["payable_after_step2_inr"] for l in d["line_items"]}
    assert by_line[2] == "2666.67" and by_line[3] == "3733.33" and by_line[7] == "3200.00"


def test_c03_copay_after_deductions():
    lines = [L(1, "Room", "room", 9000, 5), L(2, "Nursing", "nursing", 3000, 5),
             L(3, "Consultant", "doctor_fee", 7000), L(4, "Lab", "diagnostics", 2400),
             L(5, "Consumables", "consumables", 1800), L(6, "Medicines", "medicines", 5400),
             L(7, "Registration fee", "non_payable", 450)]
    d = adjudicate(facts(lines, claimed=29050, sum_insured=300000, dob="1961-11-04",
                         admission="2026-09-01", discharge="2026-09-06"), CFG)
    assert d["payable_inr"] == "25740.00" and d["age"] == 64
    assert codes(d) == {"NON_PAYABLE": Decimal("450.00"), "CO_PAY": Decimal("2860.00")}


def test_c11_icu_two_percent_cap():
    lines = [L(1, "ICU charges", "icu", 25200, 3), L(2, "Nursing", "nursing", 1800, 3),
             L(3, "Consultant", "doctor_fee", 7200), L(4, "Lab", "diagnostics", 2400),
             L(5, "X-ray", "diagnostics", 2800), L(6, "Consumables", "consumables", 2600),
             L(7, "Medicines", "medicines", 3200)]
    d = adjudicate(facts(lines, claimed=45200, sum_insured=300000), CFG)
    assert d["payable_inr"] == "35428.57"
    assert codes(d) == {"ROOM_RENT_PROPORTIONATE": Decimal("9771.43")}


def test_mixed_ward_and_icu_split_by_days():
    # 2 ward days at 6000 (cap 4000 -> 2/3) + 2 ICU days at 8000 (cap 8000 -> 1). Factor = 5/6.
    lines = [L(1, "Room", "room", 12000, 2), L(2, "ICU", "icu", 16000, 2), L(3, "Nursing", "nursing", 6000)]
    d = adjudicate(facts(lines, claimed=34000), CFG)
    by_line = {l["line_no"]: l["payable_after_step2_inr"] for l in d["line_items"]}
    assert by_line == {1: "8000.00", 2: "16000.00", 3: "5000.00"}


def test_c16_cataract_sublimit_then_copay():
    lines = [L(1, "Room", "room", 3000), L(2, "Nursing", "nursing", 800), L(3, "Consultant", "doctor_fee", 2400),
             L(4, "Phaco", "procedure", 32000), L(5, "IOL", "implants", 14000), L(6, "Lab", "diagnostics", 2400),
             L(7, "X-ray", "diagnostics", 1200), L(8, "Consumables", "consumables", 2600),
             L(9, "Medicines", "medicines", 5400)]
    d = adjudicate(facts(lines, claimed=63800, sum_insured=500000, dob="1955-07-09", admission="2026-09-17",
                         discharge="2026-09-18", inception="2023-05-17", diagnosis="Senile cataract",
                         procedure="cataract (left eye)", eye="left"), CFG)
    assert d["payable_inr"] == "36000.00"
    assert codes(d) == {"SUB_LIMIT": Decimal("23800.00"), "CO_PAY": Decimal("4000.00")}


def test_c15_balance_cap_is_not_a_flag():
    lines = [L(1, "Room", "room", 6000, 2), L(2, "Medicines", "medicines", 18200)]
    d = adjudicate(facts(lines, claimed=24200, sum_insured=300000, remaining=13000), CFG)
    assert d["payable_inr"] == "13000.00" and d["route"] == "auto" and d["flags"] == []
    assert codes(d) == {"BALANCE_CAP": Decimal("11200.00")}


def test_cataract_inside_24_months_rejects_to_processor():
    d = adjudicate(facts([L(1, "Phaco", "procedure", 30000)], claimed=30000, inception="2025-11-14",
                         admission="2026-10-14", discharge="2026-10-15", diagnosis="Senile cataract"), CFG)
    assert (d["decision"], d["payable_inr"], d["route"], d["flags"]) == ("reject", "0.00", "processor", ["WAITING_PERIOD"])
    assert d["deductions"] == []


def test_accident_exempt_from_initial_wait():
    kw = dict(claimed=10000, inception="2026-08-20", admission="2026-09-01", discharge="2026-09-02")
    assert adjudicate(facts([L(1, "Meds", "medicines", 10000)], cause="accident", **kw), CFG)["decision"] == "approve"
    assert adjudicate(facts([L(1, "Meds", "medicines", 10000)], cause="illness", **kw), CFG)["decision"] == "reject"


def test_inactive_policy_has_no_flag():
    d = adjudicate(facts([L(1, "Meds", "medicines", 1000)], claimed=1000, status="lapsed"), CFG)
    assert (d["decision"], d["reject_code"], d["flags"], d["route"]) == ("reject", "POLICY_INACTIVE", [], "processor")


@pytest.mark.parametrize("amount,route", [(25000, "auto"), (25000.01, "processor"),
                                          (100000, "processor"), (100000.01, "processor_and_reviewer")])
def test_route_thresholds(amount, route):
    d = adjudicate(facts([L(1, "Meds", "medicines", amount)], claimed=amount, sum_insured=1000000), CFG)
    assert d["route"] == route


def test_instruction_flag_changes_nothing_but_route():
    d = adjudicate(facts([L(1, "Meds", "medicines", 5000)], claimed=5000, flags=["INSTRUCTION_IN_DOCUMENT"]), CFG)
    assert (d["payable_inr"], d["route"], d["flags"]) == ("5000.00", "processor", ["INSTRUCTION_IN_DOCUMENT"])


def test_duplicate_rule_is_order_independent():
    a = {"claim_id": "CLM-A", "filed_on": "2026-09-01"}
    b = {"claim_id": "CLM-B", "filed_on": "2026-09-05"}
    assert not is_duplicate(a, [dict(b, settled=False)])
    assert is_duplicate(b, [dict(a, settled=False)])
    assert is_duplicate(a, [{"claim_id": "OLD", "filed_on": "2026-10-01", "settled": True}])
