"""Full harness: drive every public claim through the real graph and mock services.

For each claim: start it; deliver late documents when the agent emails a request; perform the
approver actions from expected/public.json when it waits for a person; then build the results file
from our database and the payment service, run grade.py, and count payments per claim.

    python -m harness.run [--claims CLM-...] [--no-reset] [--out results.json]
Needs the mock services running (uvicorn harborline.mocks.app:app --port 8001).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import httpx

from harborline import runner, store
from harborline.agents import approval
from harborline.config import REPO_ROOT, get_settings
from harborline.graph.build import LATE_FILENAMES
from harborline.money import D
from harborline.tools import services

ROLE_USER = {"claims_processor": "u_proc_01", "medical_reviewer": "u_med_01"}


def drive(claim_id: str, expected: dict, late_dir: Path, log) -> None:
    actions = list(expected.get("approver_actions", []))
    run = runner.advance(claim_id)
    for _ in range(20):
        state = run.get("state")
        if state == "CLOSED":
            return
        if state == "WAITING_FOR_DOCS":
            requested = [e["doc_type"] for e in services.list_emails(claim_id) if e["kind"] == "docs_request"]
            have = {d["filename"] for d in services.list_documents(claim_id)}
            for doc in requested:
                fname = LATE_FILENAMES.get(doc)
                if fname and fname not in have and (late_dir / claim_id / fname).exists():
                    services.upload_document(claim_id, fname, (late_dir / claim_id / fname).read_bytes())
                    log(f"  delivered {fname}")
        elif state in ("WAITING_FOR_PROCESSOR", "WAITING_FOR_PROCESSOR_AND_REVIEWER"):
            want_role = "medical_reviewer" if run.get("sub_status") == "reviewer" else "claims_processor"
            if not actions or actions[0]["role"] != want_role:
                log(f"  STOP: waiting for {want_role}, next expected action {actions[:1]}")
                return
            a = actions.pop(0)
            approval.record_action(claim_id, ROLE_USER[a["role"]], a["action"],
                                   amount=a.get("amount_inr"), reason=a.get("reason"))
            log(f"  {a['role']} {a['action']}")
        else:
            log(f"  STOP: unexpected state {run}")
            return
        run = runner.advance(claim_id)
    log("  STOP: too many steps")


def result_record(claim_id: str) -> tuple[dict, int]:
    draft = store.get_draft(claim_id)
    rows = store.approvals(claim_id)
    pays = services.list_payments(claim_id)
    paid = sum((D(p["amount_inr"]) for p in pays), D("0"))
    rec = {
        "claim_id": claim_id,
        "decision": approval.final_decision(draft, rows) if draft else "pending_docs",
        "payable_inr": float(draft["payable_inr"]) if draft else 0.0,
        "paid_inr": float(paid),
        "deductions": [{"code": d["code"], "amount_inr": float(d["amount_inr"])} for d in (draft or {}).get("deductions", [])],
        "route": (draft or {}).get("route"),
        "flags": (draft or {}).get("flags", []),
        "approvals": [{"by": a["actor"], "at": a["at"], "action": a["action"]} for a in rows],
        "payout": {"status": "paid", "payment_id": pays[0]["payment_id"],
                   "idempotency_key": pays[0]["idempotency_key"]} if pays else None,
    }
    return rec, len(pays)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--claims", nargs="*")
    ap.add_argument("--no-reset", action="store_true")
    ap.add_argument("--out", default=str(REPO_ROOT / "results.json"))
    args = ap.parse_args()
    root = get_settings().claim_pack_dir
    expected = {e["claim_id"]: e for e in json.loads((root / "expected" / "public.json").read_text())}
    ids = args.claims or list(expected)
    if not args.no_reset:
        httpx.post(get_settings().mock_base_url + "/admin/reset", timeout=600).raise_for_status()
        store.reset()

    results, dupes, timings = [], {}, {}
    for cid in ids:
        t0 = time.time()
        print(f"{expected.get(cid, {}).get('case', '?')} {cid}")
        drive(cid, expected.get(cid, {}), root / "harness" / "late_documents", print)
        rec, n = result_record(cid)
        timings[cid] = round(time.time() - t0, 1)
        if n > 1:
            dupes[cid] = n
        results.append(rec)
        print(f"  -> {store.get_run(cid)} paid={rec['paid_inr']} payments={n} {timings[cid]}s")

    Path(args.out).write_text(json.dumps({"results": results}, indent=2))
    print(f"\nwrote {args.out}; duplicate payments: {dupes or 0}; mean seconds/claim: "
          f"{sum(timings.values()) / max(len(timings), 1):.1f}\n")
    return subprocess.call([sys.executable, str(root / "grade.py"), args.out])


if __name__ == "__main__":
    raise SystemExit(main())
