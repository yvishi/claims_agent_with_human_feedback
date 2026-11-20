"""claims_app database: claim runs, frozen drafts, approvals, payments, letters, audit."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import psycopg
from psycopg.types.json import Jsonb

from harborline.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS claim_runs (
  claim_id text PRIMARY KEY, state text NOT NULL, sub_status text, route text,
  started_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS decisions (
  claim_id text PRIMARY KEY, decision text NOT NULL, reject_code text, claimed numeric(14,2) NOT NULL,
  payable numeric(14,2) NOT NULL, deductions jsonb NOT NULL, flags jsonb NOT NULL, route text NOT NULL,
  draft jsonb NOT NULL, rules_version text NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS approvals (
  claim_id text NOT NULL, step text NOT NULL, actor text NOT NULL, role text NOT NULL, action text NOT NULL,
  amount numeric(14,2), reason text, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (claim_id, step));
CREATE TABLE IF NOT EXISTS payments_local (
  claim_id text PRIMARY KEY, idempotency_key text UNIQUE NOT NULL, amount numeric(14,2) NOT NULL,
  status text NOT NULL, payment_id text, attempts int NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS letters (
  claim_id text PRIMARY KEY, body text NOT NULL, fallback_used boolean NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY, claim_id text NOT NULL, state text, event text NOT NULL, input_hash text,
  tool text, result jsonb, model text, prompt_version text, actor text, at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION audit_no_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_append_only ON audit_events;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_no_change();
"""
APP_TABLES = ("claim_runs", "decisions", "approvals", "payments_local", "letters")


def connect() -> psycopg.Connection:
    return psycopg.connect(get_settings().app_db_url, autocommit=True)


def setup() -> None:
    with connect() as conn:
        conn.execute(SCHEMA)


def reset() -> None:
    """Dev/harness only: clear run tables, audit, and LangGraph checkpoints."""
    with connect() as conn:
        conn.execute(SCHEMA)
        conn.execute("TRUNCATE " + ", ".join(APP_TABLES))
        conn.execute("ALTER TABLE audit_events DISABLE TRIGGER audit_append_only")
        conn.execute("TRUNCATE audit_events")
        conn.execute("ALTER TABLE audit_events ENABLE TRIGGER audit_append_only")
        for t in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
            conn.execute(f"DO $$ BEGIN IF to_regclass('{t}') IS NOT NULL THEN EXECUTE 'TRUNCATE {t}'; END IF; END $$")


def _hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


def audit(claim_id: str, event: str, *, state: str | None = None, tool: str | None = None, inputs=None,
          result=None, actor: str = "agent", model: str | None = None, prompt_version: str | None = None,
          conn: psycopg.Connection | None = None) -> None:
    sql = """INSERT INTO audit_events (claim_id, state, event, input_hash, tool, result, model, prompt_version, actor)
             VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)"""
    args = (claim_id, state, event, _hash(inputs) if inputs is not None else None, tool,
            Jsonb(result) if result is not None else None, model, prompt_version, actor)
    if conn is not None:
        conn.execute(sql, args)
    else:
        with connect() as c:
            c.execute(sql, args)


def set_state(claim_id: str, state: str, *, sub_status: str | None = None, route: str | None = None) -> None:
    with connect() as conn:
        conn.execute("""INSERT INTO claim_runs (claim_id, state, sub_status, route) VALUES (%s,%s,%s,%s)
                        ON CONFLICT (claim_id) DO UPDATE SET state=EXCLUDED.state, sub_status=EXCLUDED.sub_status,
                        route=COALESCE(EXCLUDED.route, claim_runs.route), updated_at=now()""",
                     (claim_id, state, sub_status, route))
        audit(claim_id, "state", state=state, result={"sub_status": sub_status} if sub_status else None, conn=conn)


def get_run(claim_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT state, sub_status, route FROM claim_runs WHERE claim_id=%s", (claim_id,)).fetchone()
    return row and {"state": row[0], "sub_status": row[1], "route": row[2]}


def freeze_decision(draft: dict) -> dict:
    """Write the draft once. A re-run never overwrites it. Returns the frozen draft."""
    with connect() as conn:
        conn.execute("""INSERT INTO decisions (claim_id, decision, reject_code, claimed, payable, deductions, flags,
                        route, draft, rules_version) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (claim_id) DO NOTHING""",
                     (draft["claim_id"], draft["decision"], draft["reject_code"], draft["claimed_inr"],
                      draft["payable_inr"], Jsonb(draft["deductions"]), Jsonb(draft["flags"]), draft["route"],
                      Jsonb(draft), draft["rules_version"]))
        return conn.execute("SELECT draft FROM decisions WHERE claim_id=%s", (draft["claim_id"],)).fetchone()[0]


def get_draft(claim_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT draft FROM decisions WHERE claim_id=%s", (claim_id,)).fetchone()
    return row and row[0]


def approvals(claim_id: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute("""SELECT step, actor, role, action, amount, reason, at FROM approvals
                               WHERE claim_id=%s ORDER BY at""", (claim_id,)).fetchall()
    return [{"step": r[0], "actor": r[1], "role": r[2], "action": r[3],
             "amount": str(r[4]) if r[4] is not None else None, "reason": r[5], "at": r[6].isoformat()}
            for r in rows]


def insert_approval(conn, claim_id, step, actor, role, action, amount=None, reason=None) -> bool:
    cur = conn.execute("""INSERT INTO approvals (claim_id, step, actor, role, action, amount, reason)
                          VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (claim_id, step) DO NOTHING""",
                       (claim_id, step, actor, role, action, amount, reason))
    return cur.rowcount == 1


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
