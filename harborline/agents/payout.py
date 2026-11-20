"""Payout agent: exactly-once payment.

1. Permission gate: the approvals for the route must exist and the amount must equal the approved amount.
2. Look first: if a payment with our key exists, adopt it (covers a crash after the POST).
3. Balance re-check under a per-policy advisory lock (after look-first, so our own recorded
   payment can never block its own adoption).
4. POST with Idempotency-Key claim_id:payout; on timeout / 5xx / connection error, look again
   before retrying. Give up after 6 attempts as payout_stuck; every retry starts with a look.
"""
from __future__ import annotations

import time

import httpx

from harborline import store
from harborline.agents import approval
from harborline.money import D
from harborline.tools import services

BACKOFF = (1, 2, 4, 8, 16)


class PayoutRefused(Exception):
    pass


def _find(claim_id: str, key: str) -> dict | None:
    return next((p for p in services.list_payments(claim_id) if p["idempotency_key"] == key), None)


def _mark(claim_id: str, key: str, amount, status: str, payment_id=None, attempts=None) -> None:
    with store.connect() as conn:
        conn.execute("""INSERT INTO payments_local (claim_id, idempotency_key, amount, status, payment_id, attempts)
                        VALUES (%s,%s,%s,%s,%s,COALESCE(%s,0))
                        ON CONFLICT (claim_id) DO UPDATE SET status=EXCLUDED.status,
                          payment_id=COALESCE(EXCLUDED.payment_id, payments_local.payment_id),
                          attempts=COALESCE(%s, payments_local.attempts), updated_at=now()""",
                     (claim_id, key, amount, status, payment_id, attempts, attempts))


def pay(claim_id: str, policy_id: str, member_id: str, amount: str, sleep=time.sleep) -> dict:
    key = f"{claim_id}:payout"

    # 1. Permission gate, from the approvals table only.
    status = approval.evaluate(claim_id)
    if status["next"] != "pay" or D(status["amount"]) != D(amount):
        store.audit(claim_id, "payout_refused", state="PAYOUT", tool="payout",
                    result={"reason": "no matching approval", "evaluated": status, "asked": amount})
        raise PayoutRefused(f"no approval for {claim_id} at {amount}: {status}")

    # 2. Look first.
    found = _find(claim_id, key)
    if found:
        _mark(claim_id, key, amount, "paid", found["payment_id"])
        store.audit(claim_id, "payout_adopted", state="PAYOUT", tool="GET /payments", result=found)
        return {"status": "paid", "payment_id": found["payment_id"], "idempotency_key": key, "adopted": True}

    with store.connect() as lock_conn:
        lock_conn.execute("SELECT pg_advisory_lock(hashtext(%s))", ("policy:" + policy_id,))
        try:
            # 3. Balance re-check under the policy lock.
            remaining = D(services.get_balance(policy_id)["remaining_inr"])
            if remaining < D(amount):
                _mark(claim_id, key, amount, "payout_blocked_balance")
                store.audit(claim_id, "payout_blocked_balance", state="PAYOUT", tool="GET /balance",
                            result={"remaining": str(remaining), "amount": amount})
                return {"status": "payout_blocked_balance", "remaining_inr": str(remaining)}
            _mark(claim_id, key, amount, "initiated")

            # 4. Pay, looking again after every unclear failure.
            body = {"claim_id": claim_id, "policy_id": policy_id, "payee_ref": member_id, "amount_inr": amount}
            for attempt in range(1, len(BACKOFF) + 2):
                if attempt > 1:
                    found = _find(claim_id, key)
                    if found:
                        _mark(claim_id, key, amount, "paid", found["payment_id"], attempt)
                        store.audit(claim_id, "payout_adopted", state="PAYOUT", tool="GET /payments",
                                    result=dict(found, attempt=attempt))
                        return {"status": "paid", "payment_id": found["payment_id"], "idempotency_key": key}
                try:
                    rec = services.create_payment(body, key)
                    _mark(claim_id, key, amount, "paid", rec["payment_id"], attempt)
                    store.audit(claim_id, "payout_paid", state="PAYOUT", tool="POST /payments",
                                inputs=body, result=dict(rec, attempt=attempt))
                    return {"status": "paid", "payment_id": rec["payment_id"], "idempotency_key": key}
                except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as e:
                    code = getattr(getattr(e, "response", None), "status_code", None)
                    if code is not None and code < 500:
                        raise
                    store.audit(claim_id, "payout_unclear", state="PAYOUT", tool="POST /payments",
                                result={"attempt": attempt, "error": type(e).__name__, "status": code})
                    if attempt <= len(BACKOFF):
                        sleep(BACKOFF[attempt - 1])
            _mark(claim_id, key, amount, "payout_stuck", attempts=len(BACKOFF) + 1)
            store.audit(claim_id, "payout_stuck", state="PAYOUT", tool="payout")
            return {"status": "payout_stuck", "idempotency_key": key}
        finally:
            lock_conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", ("policy:" + policy_id,))
