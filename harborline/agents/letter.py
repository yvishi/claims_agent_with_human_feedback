"""Letter agent: plain-language settlement letter, every deduction and its reason, no internal codes.

Iteration 1 uses the template only (fallback_used = True). Iteration 2 adds an LLM draft from
masked data, with code checking every number against the decision and this template as fallback.
"""
from __future__ import annotations

from harborline.money import D, inr

TITLES = {
    "NON_PAYABLE": "Items the policy does not cover",
    "ROOM_RENT_PROPORTIONATE": "Room rent above the policy limit",
    "SUB_LIMIT": "Limit for this treatment",
    "CO_PAY": "Your share (co-payment)",
    "BALANCE_CAP": "Sum insured remaining for this policy year",
}
REJECT_REASONS = {
    "POLICY_INACTIVE": "your policy was not active on the date of admission",
    "WAITING_PERIOD": "the treatment falls within a waiting period of your policy",
    "DUPLICATE": "this hospital bill has already been claimed",
}


def render(*, member_name: str, claim_id: str, draft: dict, outcome: str, paid: str,
           approvals: list[dict]) -> str:
    claimed = D(draft["claimed_inr"])
    lines = [f"Dear {member_name},", "", f"Re: your reimbursement claim {claim_id}", ""]
    if outcome == "reject":
        rej = next((a for a in approvals if a["action"] == "reject"), None)
        why = REJECT_REASONS.get(draft.get("reject_code") or "", None)
        if why is None and rej and rej.get("reason"):
            why = rej["reason"]
            why = REJECT_REASONS.get(why, why)
        lines += [f"We are unable to pay this claim of {inr(claimed)} because {why or 'it does not meet the policy terms'}.",
                  "", "If you have documents that change this, please reply to this letter and we will review it again."]
    else:
        lines += [f"You claimed {inr(claimed)}. We have approved {inr(D(paid))}, which is being paid to your "
                  f"registered bank account.", ""]
        if draft["deductions"]:
            lines.append("How we worked out the amount:")
            for d in draft["deductions"]:
                lines.append(f"  - {TITLES.get(d['code'], 'Adjustment')}: {inr(D(d['amount_inr']))}. {d['why']}")
            lines.append("")
        payable = D(draft["payable_inr"])
        if payable != claimed and not draft["deductions"]:
            lines += [f"The amount is based on the itemised bill lines, which add up to {inr(payable)}.", ""]
        edit = next((a for a in reversed(approvals) if a["action"] == "edit"), None)
        if edit:
            lines += [f"Our claims team adjusted the amount from {inr(payable)} to {inr(D(edit['amount']))}: "
                      f"{edit['reason']}", ""]
    lines += ["If you have any questions, reply to this letter quoting your claim number.", "",
              "Yours sincerely,", "Claims Team, Harborline Health Insurance"]
    return "\n".join(lines)
