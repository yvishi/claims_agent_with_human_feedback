"""The claim state machine. One LangGraph thread per claim (thread_id = claim_id), Postgres checkpoints.

Visible states (claim_runs.state) are exactly the brief's. Rules every node follows:
- A node may run twice (killed before its checkpoint), so each outside write is check-then-act with
  an idempotency key claim_id:step.
- No side effect in a node that calls interrupt(): wait nodes only interrupt and read. The visible
  WAITING_* state is written by the node before the wait.
"""
from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from harborline import store
from harborline.agents import adjudicator, approval, intake, letter, payout
from harborline.agents.bill_reader import read_documents
from harborline.config import get_settings
from harborline.privacy import vault
from harborline.rules.engine import load_rules
from harborline.tools import services

LATE_FILENAMES = {"discharge_summary": "discharge-summary.pdf", "prescription": "prescription.pdf",
                  "receipt": "receipt.pdf", "final_bill": "bill-1.pdf"}


class ClaimState(TypedDict, total=False):
    claim_id: str
    claim: dict          # claim form fields without payee details
    docs_round: int
    missing: list[str]
    docs: dict           # parsed documents (no free text, no names)
    draft: dict
    outcome: dict        # from approval.evaluate
    payout: dict
    closed: bool


PRIVATE_CLAIM_FIELDS = ("payee",)


# ---- Intake agent ---------------------------------------------------------------------------
def received(s: ClaimState) -> dict:
    cid = s["claim_id"]
    store.set_state(cid, "RECEIVED")
    claim = {k: v for k, v in services.get_claim(cid).items() if k not in PRIVATE_CLAIM_FIELDS}
    store.audit(cid, "claim_loaded", state="RECEIVED", tool="GET /claims/{id}", inputs=claim)
    return {"claim": claim, "docs_round": s.get("docs_round", 0)}


def docs_check(s: ClaimState) -> dict:
    cid = s["claim_id"]
    store.set_state(cid, "DOCS_CHECK")
    files = [d["filename"] for d in services.list_documents(cid)]
    missing = intake.missing_documents(files)
    store.audit(cid, "docs_checked", state="DOCS_CHECK", tool="GET /documents", result={"files": files, "missing": missing})
    if missing:
        return {"missing": missing, "docs_round": s.get("docs_round", 0) + 1}  # round fixed before any email
    return {"missing": []}


def request_docs(s: ClaimState) -> dict:
    cid, rnd = s["claim_id"], s["docs_round"]
    sent = {e["idempotency_key"] for e in services.list_emails(cid)}
    for doc in s["missing"]:
        key = f"{cid}:docs_request:{doc}:{rnd}"
        if key in sent:
            continue
        services.send_email({
            "claim_id": cid, "to_member": s["claim"]["member_id"], "kind": "docs_request", "doc_type": doc,
            "subject": f"Claim {cid}: please send your {doc.replace('_', ' ')}",
            "body": f"To process claim {cid} we need your {doc.replace('_', ' ')}. Please upload it.",
        }, key)
        store.audit(cid, "docs_requested", state="WAITING_FOR_DOCS", tool="POST /emails", result={"key": key})
    store.set_state(cid, "WAITING_FOR_DOCS")
    return {}


def wait_docs(s: ClaimState) -> dict:
    interrupt({"waiting_for": "documents", "missing": s["missing"]})
    return {}


# ---- Bill reader agent ----------------------------------------------------------------------
def read_bills(s: ClaimState) -> dict:
    cid = s["claim_id"]
    store.set_state(cid, "READ_BILLS")
    files = {d["filename"]: services.get_document(cid, d["filename"]) for d in services.list_documents(cid)}
    claim_full = services.get_claim(cid)  # names for the deny-list; used here, never stored in state
    deny = [services.get_member(claim_full["member_id"])["name"], (claim_full.get("payee") or {}).get("name", "")]
    docs = read_documents(files, [n for n in deny if n], load_rules(str(get_settings().rules_file)))
    vault.put(cid, docs.pop("pii"))  # encrypted; deleted at CLOSED
    for b in docs["bills"]:
        b.pop("other_text", None)  # keep free text out of checkpoints even though it is masked
    store.audit(cid, "bills_read", state="READ_BILLS", tool="bill_reader",
                result={"reads": docs["reads"], "lines": sum(len(b["lines"]) for b in docs["bills"]),
                        "doc_flags": docs["doc_flags"], "review_reasons": docs["review_reasons"]})
    return {"docs": docs}


# ---- Adjudicator agent ----------------------------------------------------------------------
def policy_check(s: ClaimState) -> dict:
    store.set_state(s["claim_id"], "POLICY_CHECK")
    return {}


def adjudicate(s: ClaimState) -> dict:
    cid, claim = s["claim_id"], s["claim"]
    store.set_state(cid, "ADJUDICATE")
    policy = services.get_policy(claim["policy_id"])
    member = services.get_member(claim["member_id"])
    balance = services.get_balance(claim["policy_id"])
    hospital = services.get_hospital(claim["hospital_id"])
    dups = [o for b in s["docs"]["bills"] if b["bill_no"]
            for o in services.find_claims_by_bill(b["bill_no"], claim["hospital_id"]) if o["claim_id"] != cid]
    facts = adjudicator.build_facts(claim, s["docs"], policy, {"dob": member["dob"]}, balance, hospital, dups)
    draft = adjudicator.run(facts)
    store.audit(cid, "policy_checked", state="POLICY_CHECK", tool="policy service",
                result={"status": policy["status"], "remaining": balance["remaining_inr"],
                        "watch_list": hospital.get("watch_list"), "duplicates": dups})
    services.post_decision(cid, {"stage": "draft", "decision": draft["decision"], "payable_inr": draft["payable_inr"],
                                 "route": draft["route"], "flags": draft["flags"]}, f"{cid}:draft")
    store.audit(cid, "draft", state="ADJUDICATE", tool="rules_engine", inputs=facts,
                result={k: draft[k] for k in ("decision", "payable_inr", "deductions", "flags", "route",
                                              "review_reasons", "rules_version")})
    return {"draft": draft}


def route(s: ClaimState) -> dict:
    cid = s["claim_id"]
    store.set_state(cid, "ROUTE")
    draft = store.freeze_decision(s["draft"])  # frozen: a re-run keeps the first draft
    r = draft["route"]
    if r == "auto":
        store.set_state(cid, "AUTO_APPROVED", route=r)
    elif r == "processor":
        store.set_state(cid, "WAITING_FOR_PROCESSOR", route=r)
    else:
        store.set_state(cid, "WAITING_FOR_PROCESSOR_AND_REVIEWER", sub_status="processor", route=r)
    return {"draft": draft}


# ---- Approval agent -------------------------------------------------------------------------
def auto_approved(s: ClaimState) -> dict:
    approval.record_auto(s["claim_id"], s["draft"])
    return {"outcome": approval.evaluate(s["claim_id"], s["draft"])}


def wait_processor(s: ClaimState) -> dict:
    outcome = approval.evaluate(s["claim_id"], s["draft"])
    if outcome["next"] == "wait_processor":
        interrupt({"waiting_for": "processor"})
        outcome = approval.evaluate(s["claim_id"], s["draft"])
    return {"outcome": outcome}


def wait_reviewer(s: ClaimState) -> dict:
    outcome = approval.evaluate(s["claim_id"], s["draft"])
    if outcome["next"] == "wait_reviewer":
        interrupt({"waiting_for": "reviewer"})
        outcome = approval.evaluate(s["claim_id"], s["draft"])
    return {"outcome": outcome}


# ---- Payout agent ---------------------------------------------------------------------------
def do_payout(s: ClaimState) -> dict:
    cid, claim = s["claim_id"], s["claim"]
    store.set_state(cid, "PAYOUT")
    result = payout.pay(cid, claim["policy_id"], claim["member_id"], s["outcome"]["amount"])
    return {"payout": result}


# ---- Letter agent ---------------------------------------------------------------------------
def write_letter(s: ClaimState) -> dict:
    cid = s["claim_id"]
    store.set_state(cid, "LETTER")
    key = f"{cid}:letter"
    if any(e["idempotency_key"] == key for e in services.list_emails(cid)):
        return {}
    rows = store.approvals(cid)
    outcome = approval.final_decision(s["draft"], rows)
    paid = s["outcome"]["amount"] if outcome != "reject" else "0.00"
    # The real name is fetched here, used for the letter, and never put into graph state.
    name = services.get_member(s["claim"]["member_id"])["name"]
    body = letter.render(member_name=name, claim_id=cid, draft=s["draft"], outcome=outcome, paid=paid, approvals=rows)
    with store.connect() as conn:  # store before sending
        conn.execute("""INSERT INTO letters (claim_id, body, fallback_used) VALUES (%s,%s,true)
                        ON CONFLICT (claim_id) DO NOTHING""", (cid, body))
    services.send_email({"claim_id": cid, "to_member": s["claim"]["member_id"], "kind": "settlement_letter",
                         "subject": f"Your claim {cid}: settlement letter", "body": body}, key)
    store.audit(cid, "letter_sent", state="LETTER", tool="POST /emails", result={"key": key, "template": True})
    return {}


def closed(s: ClaimState) -> dict:
    cid = s["claim_id"]
    rows = store.approvals(cid)
    services.post_decision(cid, {"stage": "final", "decision": approval.final_decision(s["draft"], rows),
                                 "paid_inr": s.get("outcome", {}).get("amount") if s.get("payout") else "0.00",
                                 "payout": s.get("payout")}, f"{cid}:final")
    vault.delete(cid)
    store.set_state(cid, "CLOSED")
    return {"closed": True}


# ---- Edges ----------------------------------------------------------------------------------
def after_docs_check(s: ClaimState) -> str:
    return "request_docs" if s.get("missing") else "read_bills"


def after_route(s: ClaimState) -> str:
    return {"auto": "auto_approved"}.get(s["draft"]["route"], "wait_processor")


def after_wait(s: ClaimState) -> str:
    return {"pay": "payout", "reject": "letter", "wait_reviewer": "wait_reviewer",
            "wait_processor": "wait_processor"}[s["outcome"]["next"]]


def after_payout(s: ClaimState) -> str:
    return "letter" if s["payout"]["status"] == "paid" else END  # blocked/stuck: stop for a person


def build(checkpointer: Any):
    g = StateGraph(ClaimState)
    for name, fn in [("received", received), ("docs_check", docs_check), ("request_docs", request_docs),
                     ("wait_docs", wait_docs), ("read_bills", read_bills), ("policy_check", policy_check),
                     ("adjudicate", adjudicate), ("route", route), ("auto_approved", auto_approved),
                     ("wait_processor", wait_processor), ("wait_reviewer", wait_reviewer),
                     ("payout", do_payout), ("letter", write_letter), ("closed", closed)]:
        g.add_node(name, fn)
    g.add_edge(START, "received")
    g.add_edge("received", "docs_check")
    g.add_conditional_edges("docs_check", after_docs_check, ["request_docs", "read_bills"])
    g.add_edge("request_docs", "wait_docs")
    g.add_edge("wait_docs", "docs_check")
    g.add_edge("read_bills", "policy_check")
    g.add_edge("policy_check", "adjudicate")
    g.add_edge("adjudicate", "route")
    g.add_conditional_edges("route", after_route, ["auto_approved", "wait_processor"])
    g.add_edge("auto_approved", "payout")
    g.add_conditional_edges("wait_processor", after_wait, ["payout", "letter", "wait_reviewer", "wait_processor"])
    g.add_conditional_edges("wait_reviewer", after_wait, ["payout", "letter", "wait_reviewer", "wait_processor"])
    g.add_conditional_edges("payout", after_payout, ["letter", END])
    g.add_edge("letter", "closed")
    g.add_edge("closed", END)
    return g.compile(checkpointer=checkpointer)
