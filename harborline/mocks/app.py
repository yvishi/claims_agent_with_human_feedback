"""Mock Harborline services: Policy, Claims, Documents, Email, Payments (one FastAPI app).

    uvicorn harborline.mocks.app:app --port 8001

Payments: idempotent on the Idempotency-Key header; recording a payment reduces the policy's
remaining balance. FAULT_MODE: off | on (claims listed in the pack's run_config.json) | all.
With faults, a seeded roll per call: 10% -> 500 before recording, 20% -> record then hang
(async sleep, longer than the client's timeout), else 201.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import uuid
from decimal import Decimal

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from harborline.config import get_settings
from harborline.mocks import db

app = FastAPI(title="Harborline mock services")
HANG_SECONDS = float(os.getenv("FAULT_HANG_SECONDS", "8"))


def _one(sql: str, *args):
    with db.connect() as conn:
        return conn.execute(sql, args).fetchone()


def _all(sql: str, *args):
    with db.connect() as conn:
        return conn.execute(sql, args).fetchall()


@app.on_event("startup")
def _startup():
    with db.connect() as conn:
        conn.execute(db.SCHEMA)
    if os.getenv("MOCK_LOAD_ON_START", "1") == "1":
        db.load()


@app.post("/admin/reset")
def reset():
    return db.load()


# ---- Policy ---------------------------------------------------------------------------------
@app.get("/policies/{policy_id}")
def get_policy(policy_id: str):
    row = _one("SELECT data FROM policies WHERE policy_id=%s", policy_id)
    if not row:
        raise HTTPException(404)
    return row[0]


@app.get("/policies/{policy_id}/balance")
def get_balance(policy_id: str):
    row = _one("SELECT data, used_inr FROM policies WHERE policy_id=%s", policy_id)
    if not row:
        raise HTTPException(404)
    si = Decimal(str(row[0]["sum_insured_inr"]))
    return {"policy_id": policy_id, "sum_insured_inr": str(si), "used_inr": str(row[1]),
            "remaining_inr": str(si - row[1])}


@app.get("/members/{member_id}")
def get_member(member_id: str):
    row = _one("SELECT data FROM members WHERE member_id=%s", member_id)
    if not row:
        raise HTTPException(404)
    return row[0]


@app.get("/hospitals/{hospital_id}")
def get_hospital(hospital_id: str):
    row = _one("SELECT data FROM hospitals WHERE hospital_id=%s", hospital_id)
    if not row:
        raise HTTPException(404)
    return row[0]


# ---- Claims ---------------------------------------------------------------------------------
@app.get("/claims")
def find_claims(bill_no: str, hospital_id: str):
    rows = _all("""SELECT c.claim_id, c.filed_on, c.settled FROM claim_bills b JOIN claims c USING (claim_id)
                   WHERE b.bill_no=%s AND b.hospital_id=%s ORDER BY c.filed_on, c.claim_id""", bill_no, hospital_id)
    return [{"claim_id": r[0], "filed_on": r[1].isoformat(), "settled": r[2]} for r in rows]


@app.get("/claims/{claim_id}")
def get_claim(claim_id: str):
    row = _one("SELECT data FROM claims WHERE claim_id=%s AND NOT settled", claim_id)
    if not row:
        raise HTTPException(404)
    return row[0]


@app.post("/claims/{claim_id}/decision")
def post_decision(claim_id: str, body: dict, idempotency_key: str = Header(...)):
    with db.connect() as conn:
        conn.execute("INSERT INTO decisions VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                     (idempotency_key, claim_id, Jsonb(body)))
        row = conn.execute("SELECT body FROM decisions WHERE idempotency_key=%s", (idempotency_key,)).fetchone()
    return {"idempotency_key": idempotency_key, "stored": row[0]}


# ---- Documents ------------------------------------------------------------------------------
@app.get("/claims/{claim_id}/documents")
def list_documents(claim_id: str):
    rows = _all("SELECT filename, uploaded_at FROM documents WHERE claim_id=%s ORDER BY filename", claim_id)
    return [{"filename": r[0], "uploaded_at": r[1].isoformat()} for r in rows]


@app.get("/claims/{claim_id}/documents/{filename}")
def get_document(claim_id: str, filename: str):
    row = _one("SELECT content FROM documents WHERE claim_id=%s AND filename=%s", claim_id, filename)
    if not row:
        raise HTTPException(404)
    return Response(content=bytes(row[0]), media_type="application/pdf")


@app.post("/claims/{claim_id}/documents")
async def upload_document(claim_id: str, file: UploadFile = File(...)):
    content = await file.read()
    def _save():
        with db.connect() as conn:
            conn.execute("""INSERT INTO documents (claim_id, filename, content) VALUES (%s, %s, %s)
                            ON CONFLICT (claim_id, filename) DO UPDATE SET content=EXCLUDED.content""",
                         (claim_id, file.filename, content))
    await run_in_threadpool(_save)
    return {"claim_id": claim_id, "filename": file.filename}


# ---- Email ----------------------------------------------------------------------------------
class EmailIn(BaseModel):
    claim_id: str
    to_member: str
    kind: str
    doc_type: str | None = None
    subject: str
    body: str


@app.post("/emails", status_code=201)
def send_email(e: EmailIn, idempotency_key: str = Header(...)):
    with db.connect() as conn:
        conn.execute("""INSERT INTO emails (claim_id, idempotency_key, to_member, kind, doc_type, subject, body)
                        VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (idempotency_key) DO NOTHING""",
                     (e.claim_id, idempotency_key, e.to_member, e.kind, e.doc_type, e.subject, e.body))
    return {"idempotency_key": idempotency_key}


@app.get("/emails")
def list_emails(claim_id: str):
    rows = _all("""SELECT idempotency_key, kind, doc_type, subject, sent_at FROM emails
                   WHERE claim_id=%s ORDER BY id""", claim_id)
    return [{"idempotency_key": r[0], "kind": r[1], "doc_type": r[2], "subject": r[3],
             "sent_at": r[4].isoformat()} for r in rows]


# ---- Payments -------------------------------------------------------------------------------
class PaymentIn(BaseModel):
    claim_id: str
    policy_id: str
    payee_ref: str      # member id; the bank details stay inside the payment service
    amount_inr: str


def _fault_claims() -> set[str] | None:
    mode = os.getenv("FAULT_MODE", get_settings().fault_mode)
    if mode == "all":
        return None  # every claim
    if mode == "on":
        cfg = get_settings().claim_pack_dir / "harness" / "run_config.json"
        return set(json.loads(cfg.read_text()).get("fault_mode_on_for", [])) if cfg.exists() else set()
    return set()


def _roll(key: str) -> str:
    faulty = _fault_claims()
    claim_id = key.split(":")[0]
    if faulty is not None and claim_id not in faulty:
        return "ok"
    with db.connect() as conn:
        n = conn.execute("SELECT count(*) FROM payment_calls WHERE idempotency_key=%s", (key,)).fetchone()[0]
    if os.getenv("FAULT_FORCE") == "timeout_first" and n == 0:
        return "timeout"
    seed = os.getenv("FAULT_SEED", "harborline")
    x = int(hashlib.sha256(f"{seed}:{key}:{n}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "error" if x < 0.10 else "timeout" if x < 0.30 else "ok"


def _existing(key: str):
    row = _one("SELECT payment_id, claim_id, amount_inr, created_at FROM payments WHERE idempotency_key=%s", key)
    return row and {"payment_id": row[0], "claim_id": row[1], "amount_inr": str(row[2]),
                    "idempotency_key": key, "created_at": row[3].isoformat()}


def _record(p: PaymentIn, key: str) -> dict:
    with db.connect() as conn, conn.transaction():
        ins = conn.execute("""INSERT INTO payments (payment_id, claim_id, idempotency_key, policy_id, payee_ref, amount_inr)
                              VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (idempotency_key) DO NOTHING RETURNING payment_id""",
                           ("PAY-" + uuid.uuid4().hex[:8].upper(), p.claim_id, key, p.policy_id, p.payee_ref,
                            Decimal(p.amount_inr))).fetchone()
        if ins:  # only a new payment uses up sum insured
            conn.execute("UPDATE policies SET used_inr = used_inr + %s WHERE policy_id=%s",
                         (Decimal(p.amount_inr), p.policy_id))
    return _existing(key)


@app.post("/payments", status_code=201)
async def create_payment(p: PaymentIn, idempotency_key: str = Header(...)):
    found = await run_in_threadpool(_existing, idempotency_key)
    if found:
        return found
    outcome = await run_in_threadpool(_roll, idempotency_key)
    await run_in_threadpool(lambda: _all("INSERT INTO payment_calls (idempotency_key, outcome) VALUES (%s,%s) RETURNING id",
                                         idempotency_key, outcome))
    if outcome == "error":
        raise HTTPException(500, "payment service error")
    rec = await run_in_threadpool(_record, p, idempotency_key)
    if outcome == "timeout":
        await asyncio.sleep(HANG_SECONDS)  # recorded, but the caller gives up first
    return rec


@app.get("/payments")
def list_payments(claim_id: str):
    rows = _all("SELECT payment_id, idempotency_key, amount_inr, created_at FROM payments WHERE claim_id=%s",
                claim_id)
    return [{"payment_id": r[0], "idempotency_key": r[1], "amount_inr": str(r[2]),
             "created_at": r[3].isoformat()} for r in rows]


# ---- Admin listings (demo console only; not part of the brief's service spec) -----------------
@app.get("/admin/claims")
def admin_claims():
    rows = _all("SELECT data FROM claims WHERE NOT settled ORDER BY claim_id")
    return [r[0] for r in rows]


@app.get("/admin/payments")
def admin_payments():
    rows = _all("SELECT payment_id, claim_id, idempotency_key, amount_inr, created_at FROM payments ORDER BY created_at")
    return [{"payment_id": r[0], "claim_id": r[1], "idempotency_key": r[2], "amount_inr": str(r[3]),
             "created_at": r[4].isoformat()} for r in rows]
