"""Adjudicator agent: assembles facts and calls the pure rules engine. No LLM, ever."""
from __future__ import annotations

from harborline.config import get_settings
from harborline.money import D, r2
from harborline.rules.engine import adjudicate, load_rules

CLAIM_FIELDS = ("claim_id", "policy_id", "member_id", "hospital_id", "cause", "admission_date",
                "discharge_date", "filed_on", "claimed_amount_inr")


def build_facts(claim: dict, docs: dict, policy: dict, member: dict, balance: dict,
                hospital: dict, duplicates: list[dict]) -> dict:
    """Only the fields the rules need. Payee name and bank details never enter the facts."""
    return {
        "claim": {k: claim.get(k) for k in CLAIM_FIELDS},
        "bills": docs["bills"],
        "discharge": docs["discharge"],
        "policy": {k: policy[k] for k in ("status", "period_start", "period_end",
                                          "inception_date", "sum_insured_inr")},
        "member_dob": member["dob"],
        "remaining": str(r2(D(str(balance["remaining_inr"])))),
        "hospital": {"watch_list": bool(hospital.get("watch_list"))},
        "duplicates": duplicates,
        "doc_flags": docs["doc_flags"],
        "review_reasons": docs["review_reasons"],
    }


def run(facts: dict) -> dict:
    return adjudicate(facts, load_rules(str(get_settings().rules_file)))
