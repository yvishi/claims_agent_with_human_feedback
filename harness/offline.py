"""Offline draft run: read the claim pack straight from disk, compute every draft, apply the
approver actions from expected/public.json, write results, and run the pack's grade.py.

No database, no services, no LLM. It checks the bill reader + adjudicator only.

    python -m harness.offline [--out results.offline.json]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from harborline.agents import adjudicator
from harborline.agents.bill_reader import read_documents
from harborline.config import REPO_ROOT, get_settings
from harborline.money import D


def load_pack(root: Path):
    data = {n: json.loads((root / "data" / f"{n}.json").read_text())
            for n in ("policies", "members", "hospitals", "settled_claims")}
    claims = {}
    for folder in sorted((root / "claims").iterdir()):
        if (folder / "claim.json").exists():
            files = {p.name: p.read_bytes() for p in folder.glob("*.pdf")}
            late = root / "harness" / "late_documents" / folder.name
            if late.exists():  # offline: pretend the late documents were delivered
                files.update({p.name: p.read_bytes() for p in late.glob("*.pdf")})
            claims[folder.name] = (json.loads((folder / "claim.json").read_text()), files)
    return data, claims


def final_outcome(draft: dict, actions: list[dict]) -> tuple[str, str]:
    decision, paid = draft["decision"], D(draft["payable_inr"])
    for a in actions:
        if a["action"] == "reject":
            return "reject", "0"
        if a["action"] == "edit":
            paid = D(str(a["amount_inr"]))
            decision = "approve" if paid == D(draft["claimed_inr"]) else "partial"
    return decision, str(paid) if decision != "reject" else "0"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO_ROOT / "results.offline.json"))
    args = ap.parse_args()
    root = get_settings().claim_pack_dir
    data, claims = load_pack(root)
    expected = {e["claim_id"]: e for e in json.loads((root / "expected" / "public.json").read_text())}
    policies = {p["policy_id"]: p for p in data["policies"]}
    members = {m["member_id"]: m for m in data["members"]}
    hospitals = {h["hospital_id"]: h for h in data["hospitals"]}

    from harborline.rules.engine import load_rules
    rules = load_rules(str(get_settings().rules_file))
    names = [m["name"] for m in data["members"]]
    docs = {cid: read_documents(files, names, rules) for cid, (_, files) in claims.items()}

    # Bill index: settled claims + every pack claim, as the Claims service will serve it.
    index: dict[tuple, list] = {}
    for s in data["settled_claims"]:
        index.setdefault((s["hospital_id"], s["bill_no"]), []).append(
            {"claim_id": s["claim_id"], "filed_on": s["settled_on"], "settled": True})
    for cid, (claim, _) in claims.items():
        for b in docs[cid]["bills"]:
            index.setdefault((claim["hospital_id"], b["bill_no"]), []).append(
                {"claim_id": cid, "filed_on": claim["filed_on"], "settled": False})

    results = []
    for cid, (claim, _) in claims.items():
        pol = policies[claim["policy_id"]]
        balance = {"remaining_inr": pol["sum_insured_inr"] - pol["used_this_year_inr"]}
        dups = [o for b in docs[cid]["bills"] for o in index.get((claim["hospital_id"], b["bill_no"]), [])
                if o["claim_id"] != cid]
        facts = adjudicator.build_facts(claim, docs[cid], pol, members[claim["member_id"]], balance,
                                        hospitals[claim["hospital_id"]], dups)
        draft = adjudicator.run(facts)
        actions = expected.get(cid, {}).get("approver_actions", []) if draft["route"] != "auto" else []
        decision, paid = final_outcome(draft, actions)
        results.append({
            "claim_id": cid, "decision": decision,
            "payable_inr": float(draft["payable_inr"]), "paid_inr": float(paid),
            "deductions": [{"code": d["code"], "amount_inr": float(d["amount_inr"])} for d in draft["deductions"]],
            "route": draft["route"], "flags": draft["flags"],
            "review_reasons": draft["review_reasons"],
        })
    Path(args.out).write_text(json.dumps({"results": results}, indent=2))
    print(f"wrote {args.out}\n")
    return subprocess.call([sys.executable, str(root / "grade.py"), args.out])


if __name__ == "__main__":
    raise SystemExit(main())
