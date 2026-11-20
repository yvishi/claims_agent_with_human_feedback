"""Console API: what the processor screen and the client-facing views read.

    uvicorn harborline.api.app:app --port 8000

Never moves money itself: approvals go through approval.record_action (DB rows), and the graph
(payout agent) pays. Claims run in a small background pool until the worker queue lands.
"""
from __future__ import annotations

import json
import os
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from harborline import runner, store
from harborline.agents import approval
from harborline.config import REPO_ROOT, get_settings
from harborline.graph.build import LATE_FILENAMES
from harborline.money import D
from harborline.tools import services

app = FastAPI(title="Harborline claims console")
app.add_middleware(SessionMiddleware, secret_key=os.getenv("CONSOLE_SECRET", "dev-only-secret"),
                   same_site="lax", max_age=8 * 3600)

EXEC = ThreadPoolExecutor(max_workers=4, thread_name_prefix="claim")
_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
_running: set[str] = set()


def _advance(claim_id: str) -> None:
    _running.add(claim_id)
    try:
        with _locks[claim_id]:
            runner.advance(claim_id)
    except Exception as e:  # keep the console alive; the error is in the audit trail
        store.audit(claim_id, "error", result={"error": type(e).__name__, "detail": str(e)[:200]})
    finally:
        _running.discard(claim_id)


def submit(claim_id: str) -> None:
    EXEC.submit(_advance, claim_id)


# ---- helpers ------------------------------------------------------------------------------
@lru_cache(maxsize=1)
def scenarios() -> dict[str, dict]:
    """Case labels from the public pack (demo nicety). Empty for the hidden pack."""
    p = get_settings().claim_pack_dir / "expected" / "public.json"
    if not p.exists():
        return {}
    return {e["claim_id"]: {"case": e["case"], "scenario": e["what_it_tests"]} for e in json.loads(p.read_text())}


@lru_cache(maxsize=256)
def member(member_id: str) -> dict:
    return services.get_member(member_id)


@lru_cache(maxsize=64)
def hospital(hospital_id: str) -> dict:
    return services.get_hospital(hospital_id)


def _mock(path: str):
    r = httpx.get(get_settings().mock_base_url + path, timeout=15)
    r.raise_for_status()
    return r.json()


def _user(request: Request) -> dict:
    uid = request.session.get("user_id")
    if uid not in approval.USERS:
        raise HTTPException(401, "Please sign in")
    return {"user_id": uid, **approval.USERS[uid]}


def _waiting_for(run: dict | None) -> str | None:
    if not run:
        return None
    if run["state"] == "WAITING_FOR_PROCESSOR":
        return "claims_processor"
    if run["state"] == "WAITING_FOR_PROCESSOR_AND_REVIEWER":
        return "medical_reviewer" if run.get("sub_status") == "reviewer" else "claims_processor"
    if run["state"] == "WAITING_FOR_DOCS":
        return "member"
    return None


# ---- auth ---------------------------------------------------------------------------------
class Login(BaseModel):
    user_id: str


@app.get("/api/users")
def users():
    return [{"user_id": k, **v} for k, v in approval.USERS.items()]


@app.post("/api/login")
def login(body: Login, request: Request):
    if body.user_id not in approval.USERS:
        raise HTTPException(400, "Unknown user")
    request.session["user_id"] = body.user_id
    return {"user_id": body.user_id, **approval.USERS[body.user_id]}


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    return _user(request)


# ---- claims -------------------------------------------------------------------------------
@app.get("/api/claims")
def list_claims(request: Request):
    _user(request)
    claims = _mock("/admin/claims")
    paid = defaultdict(lambda: D("0"))
    for p in _mock("/admin/payments"):
        paid[p["claim_id"]] += D(p["amount_inr"])
    with store.connect() as conn:
        runs = {r[0]: {"state": r[1], "sub_status": r[2], "route": r[3], "updated_at": r[4].isoformat()}
                for r in conn.execute("SELECT claim_id, state, sub_status, route, updated_at FROM claim_runs")}
        drafts = {r[0]: {"decision": r[1], "payable": str(r[2]), "flags": r[3]}
                  for r in conn.execute("SELECT claim_id, decision, payable, flags FROM decisions")}
    out = []
    for c in claims:
        cid = c["claim_id"]
        run = runs.get(cid)
        out.append({
            "claim_id": cid, **scenarios().get(cid, {}),
            "member_name": member(c["member_id"])["name"],
            "hospital_name": hospital(c["hospital_id"])["name"],
            "claimed_inr": str(c["claimed_amount_inr"]),
            "admission_date": c["admission_date"], "filed_on": c["filed_on"],
            "state": run["state"] if run else "NOT_STARTED",
            "sub_status": run["sub_status"] if run else None,
            "route": run["route"] if run else None,
            "updated_at": run["updated_at"] if run else None,
            "waiting_for": _waiting_for(run),
            "busy": cid in _running,
            "payable_inr": drafts.get(cid, {}).get("payable"),
            "draft_decision": drafts.get(cid, {}).get("decision"),
            "flags": drafts.get(cid, {}).get("flags", []),
            "paid_inr": str(paid[cid]) if cid in paid else None,
        })
    return out


@app.get("/api/claims/{claim_id}")
def claim_detail(claim_id: str, request: Request):
    _user(request)
    try:
        c = services.get_claim(claim_id)
    except httpx.HTTPStatusError:
        raise HTTPException(404, "No such claim")
    m, h = member(c["member_id"]), hospital(c["hospital_id"])
    pol, bal = services.get_policy(c["policy_id"]), services.get_balance(c["policy_id"])
    payee = c.get("payee") or {}
    with store.connect() as conn:
        letter = conn.execute("SELECT body, fallback_used, at FROM letters WHERE claim_id=%s", (claim_id,)).fetchone()
        events = conn.execute("""SELECT id, state, event, tool, result, actor, model, prompt_version, at
                                 FROM audit_events WHERE claim_id=%s ORDER BY id""", (claim_id,)).fetchall()
        pay_local = conn.execute("SELECT status, attempts FROM payments_local WHERE claim_id=%s", (claim_id,)).fetchone()
    run = store.get_run(claim_id)
    return {
        "claim_id": claim_id, **scenarios().get(claim_id, {}),
        "claim": {k: c.get(k) for k in ("cause", "admission_date", "discharge_date", "filed_on",
                                        "claimed_amount_inr", "documents", "policy_id")},
        "member": {"name": m["name"], "gender": m["gender"], "dob": m["dob"]},
        "payee": {"name": payee.get("name"), "account": "•••• " + str(payee.get("account_no", ""))[-4:]},
        "hospital": {"name": h["name"], "city": h.get("city"), "watch_list": h.get("watch_list")},
        "policy": {"plan": pol.get("plan"), "sum_insured_inr": str(pol["sum_insured_inr"]),
                   "remaining_inr": bal["remaining_inr"], "inception_date": pol["inception_date"],
                   "period_start": pol["period_start"], "period_end": pol["period_end"], "status": pol["status"]},
        "run": run, "waiting_for": _waiting_for(run), "busy": claim_id in _running,
        "draft": store.get_draft(claim_id),
        "approvals": [dict(a, name=approval.USERS.get(a["actor"], {}).get("name", "Harborline system"))
                      for a in store.approvals(claim_id)],
        "payments": services.list_payments(claim_id),
        "payment_status": {"status": pay_local[0], "attempts": pay_local[1]} if pay_local else None,
        "documents": services.list_documents(claim_id),
        "emails": services.list_emails(claim_id),
        "letter": {"body": letter[0], "template": letter[1], "at": letter[2].isoformat()} if letter else None,
        "timeline": [{"id": e[0], "state": e[1], "event": e[2], "tool": e[3], "result": e[4],
                      "actor": approval.USERS.get(e[5], {}).get("name", e[5]), "model": e[6],
                      "prompt_version": e[7], "at": e[8].isoformat()} for e in events],
    }


@app.post("/api/claims/{claim_id}/start")
def start(claim_id: str, request: Request):
    _user(request)
    submit(claim_id)
    return {"started": claim_id}


class Action(BaseModel):
    action: str
    amount_inr: float | None = None
    reason: str | None = None


@app.post("/api/claims/{claim_id}/actions")
def act(claim_id: str, body: Action, request: Request):
    user = _user(request)
    try:
        result = approval.record_action(claim_id, user["user_id"], body.action, body.amount_inr, body.reason)
    except approval.ApprovalError as e:
        raise HTTPException(400, str(e))
    submit(claim_id)  # resume the graph; the payout agent re-checks every approval itself
    return result


@app.post("/api/claims/{claim_id}/deliver-missing")
def deliver_missing(claim_id: str, request: Request):
    """Demo helper: act as the member uploading the requested documents from the pack."""
    _user(request)
    late = get_settings().claim_pack_dir / "harness" / "late_documents" / claim_id
    have = {d["filename"] for d in services.list_documents(claim_id)}
    sent = []
    for e in services.list_emails(claim_id):
        fname = LATE_FILENAMES.get(e.get("doc_type") or "")
        if e["kind"] == "docs_request" and fname and fname not in have and (late / fname).exists():
            services.upload_document(claim_id, fname, (late / fname).read_bytes())
            sent.append(fname)
    if sent:
        submit(claim_id)
    return {"delivered": sent}


@app.post("/api/demo/reset")
def demo_reset(request: Request):
    _user(request)
    httpx.post(get_settings().mock_base_url + "/admin/reset", timeout=600).raise_for_status()
    store.reset()
    member.cache_clear()
    return {"ok": True}


# ---- built frontend -------------------------------------------------------------------------
DIST = REPO_ROOT / "ui" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
