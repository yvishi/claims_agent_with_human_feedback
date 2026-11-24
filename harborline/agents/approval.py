"""Approval agent: who may act, recording actions, and what the approvals add up to.

Approvals are database rows. Nothing an LLM or a document says can stand in for one.
"""
from __future__ import annotations

from decimal import Decimal

from harborline import store
from harborline.money import D, r2
from harborline.tools import services

USERS = {
    "u_proc_01": {"name": "Asha Pillai", "role": "claims_processor"},
    "u_proc_02": {"name": "Deepak Rao", "role": "claims_processor"},
    "u_med_01": {"name": "Sunil Varma", "role": "medical_reviewer"},
}
ACTIONS = {"claims_processor": {"approve", "edit", "reject"}, "medical_reviewer": {"approve", "edit"}}


class ApprovalError(Exception):
    pass


def evaluate(claim_id: str, draft: dict | None = None) -> dict:
    """Decide what happens next from the approval rows alone.

    Returns {"next": "pay" | "reject" | "wait_processor" | "wait_reviewer", "amount": str|None}.
    The amount is the latest valid approval: reviewer edit, else processor edit, else draft payable.
    """
    draft = draft or store.get_draft(claim_id)
    rows = {a["step"]: a for a in store.approvals(claim_id)}
    route = draft["route"]
    if route == "auto":
        a = rows.get("auto")
        return {"next": "pay", "amount": draft["payable_inr"]} if a else {"next": "wait_processor", "amount": None}
    proc = rows.get("processor")
    if not proc:
        return {"next": "wait_processor", "amount": None}
    if proc["action"] == "reject":
        return {"next": "reject", "amount": "0.00"}
    amount = proc["amount"] if proc["action"] == "edit" else draft["payable_inr"]
    if route == "processor_and_reviewer":
        rev = rows.get("reviewer")
        if not rev:
            return {"next": "wait_reviewer", "amount": None}
        if rev["action"] == "edit":
            amount = rev["amount"]
    return {"next": "pay", "amount": str(r2(D(amount)))}


def record_auto(claim_id: str, draft: dict) -> None:
    if draft["route"] != "auto":
        raise ApprovalError("system:auto may approve only claims routed auto")
    with store.connect() as conn, conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (claim_id,))
        if store.insert_approval(conn, claim_id, "auto", "system:auto", "system", "approve",
                                 draft["payable_inr"], f"rules {draft['rules_version']}"):
            store.audit(claim_id, "approval", state="AUTO_APPROVED", actor="system:auto",
                        result={"action": "approve", "amount": draft["payable_inr"]}, conn=conn)


def record_action(claim_id: str, user_id: str, action: str, amount=None, reason: str | None = None) -> dict:
    """Validate and store one human action in a single transaction. The caller then resumes the graph."""
    user = USERS.get(user_id)
    if not user:
        raise ApprovalError("unknown user")
    role = user["role"]
    if action not in ACTIONS[role]:
        raise ApprovalError(f"{role} cannot {action}")
    draft = store.get_draft(claim_id)
    if not draft:
        raise ApprovalError("no draft decision yet")
    status = evaluate(claim_id, draft)
    if role == "claims_processor" and status["next"] != "wait_processor":
        raise ApprovalError("claim is not waiting for a processor")
    if role == "medical_reviewer" and status["next"] != "wait_reviewer":
        raise ApprovalError("claim is not waiting for a medical reviewer")
    if action in ("edit", "reject") and not (reason or "").strip():
        raise ApprovalError("a reason is required")
    if action == "approve" and draft["decision"] == "reject":
        raise ApprovalError("the draft proposes a rejection: reject it, or edit with an amount and a reason")
    amt: Decimal | None = None
    if action == "edit":
        amt = r2(D(str(amount)))
        claim = services.get_claim(claim_id)
        remaining = D(services.get_balance(claim["policy_id"])["remaining_inr"])
        if not (Decimal(0) < amt <= D(draft["claimed_inr"]) and amt <= remaining):
            raise ApprovalError("edited amount must be > 0, <= claimed and <= remaining sum insured")
    elif action == "approve":
        amt = D(draft["payable_inr"]) if role == "claims_processor" else D(evaluate_amount_for_reviewer(claim_id, draft))
    step = "processor" if role == "claims_processor" else "reviewer"
    with store.connect() as conn, conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (claim_id,))
        if not store.insert_approval(conn, claim_id, step, user_id, role, action,
                                     str(amt) if amt is not None else None, reason):
            raise ApprovalError("this step was already recorded")
        store.audit(claim_id, "approval", actor=user_id,
                    result={"step": step, "action": action, "amount": str(amt) if amt is not None else None,
                            "reason": reason}, conn=conn)
        if step == "processor" and draft["route"] == "processor_and_reviewer" and action != "reject":
            conn.execute("UPDATE claim_runs SET sub_status='reviewer', updated_at=now() WHERE claim_id=%s",
                         (claim_id,))
    return evaluate(claim_id, draft)


def evaluate_amount_for_reviewer(claim_id: str, draft: dict) -> str:
    proc = next(a for a in store.approvals(claim_id) if a["step"] == "processor")
    return proc["amount"] if proc["action"] == "edit" else draft["payable_inr"]


def final_decision(draft: dict, approval_rows: list[dict]) -> str:
    """Final outcome after people acted (results `decision`)."""
    rows = {a["step"]: a for a in approval_rows}
    if any(a["action"] == "reject" for a in approval_rows):
        return "reject"
    edited = rows.get("reviewer") if rows.get("reviewer", {}).get("action") == "edit" else None
    edited = edited or (rows.get("processor") if rows.get("processor", {}).get("action") == "edit" else None)
    if edited:
        return "approve" if D(edited["amount"]) == D(draft["claimed_inr"]) else "partial"
    return draft["decision"]
