"""harborline_mock: the outside world. Schema and loader from the claim pack."""
from __future__ import annotations

import json
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from harborline.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS policies  (policy_id text PRIMARY KEY, data jsonb NOT NULL, used_inr numeric(14,2) NOT NULL);
CREATE TABLE IF NOT EXISTS members   (member_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS hospitals (hospital_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS claims    (claim_id text PRIMARY KEY, data jsonb NOT NULL, filed_on date,
                                      settled boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS claim_bills (hospital_id text, bill_no text, claim_id text,
                                        PRIMARY KEY (hospital_id, bill_no, claim_id));
CREATE TABLE IF NOT EXISTS documents (claim_id text, filename text, content bytea NOT NULL,
                                      uploaded_at timestamptz NOT NULL DEFAULT now(),
                                      PRIMARY KEY (claim_id, filename));
CREATE TABLE IF NOT EXISTS emails    (id serial PRIMARY KEY, claim_id text NOT NULL, idempotency_key text UNIQUE NOT NULL,
                                      to_member text, kind text, doc_type text, subject text, body text,
                                      sent_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payments  (payment_id text PRIMARY KEY, claim_id text NOT NULL,
                                      idempotency_key text UNIQUE NOT NULL, policy_id text, payee_ref text,
                                      amount_inr numeric(14,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payment_calls (id serial PRIMARY KEY, idempotency_key text, outcome text,
                                          at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS decisions (idempotency_key text PRIMARY KEY, claim_id text NOT NULL, body jsonb NOT NULL,
                                      at timestamptz NOT NULL DEFAULT now());
"""
TABLES = ("policies", "members", "hospitals", "claims", "claim_bills", "documents", "emails",
          "payments", "payment_calls", "decisions")


def connect() -> psycopg.Connection:
    return psycopg.connect(get_settings().mock_db_url, autocommit=True)


def _pack_bill_numbers(folder: Path) -> list[str]:
    """The claims system knows which bills each filed claim carries. Read them from the bills."""
    from harborline.docs.parser import parse_bill
    from harborline.docs.reader import read_pdf
    return [b for b in (parse_bill(read_pdf(p).text, p.name)["bill_no"]
                        for p in sorted(folder.glob("bill-*.pdf"))) if b]


def load(pack: Path | None = None) -> dict:
    """Drop everything and load the pack. Late documents are NOT loaded (the harness delivers them)."""
    pack = pack or get_settings().claim_pack_dir
    data = {n: json.loads((pack / "data" / f"{n}.json").read_text())
            for n in ("policies", "members", "hospitals", "settled_claims")}
    with connect() as conn:
        conn.execute(SCHEMA)
        conn.execute("TRUNCATE " + ", ".join(TABLES) + " RESTART IDENTITY")
        with conn.cursor() as cur:
            cur.executemany("INSERT INTO policies VALUES (%s, %s, %s)",
                            [(p["policy_id"], Jsonb(p), p["used_this_year_inr"]) for p in data["policies"]])
            cur.executemany("INSERT INTO members VALUES (%s, %s)",
                            [(m["member_id"], Jsonb(m)) for m in data["members"]])
            cur.executemany("INSERT INTO hospitals VALUES (%s, %s)",
                            [(h["hospital_id"], Jsonb(h)) for h in data["hospitals"]])
            for s in data["settled_claims"]:
                cur.execute("INSERT INTO claims VALUES (%s, %s, %s, true)", (s["claim_id"], Jsonb(s), s["settled_on"]))
                cur.execute("INSERT INTO claim_bills VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                            (s["hospital_id"], s["bill_no"], s["claim_id"]))
            n = 0
            for folder in sorted((pack / "claims").iterdir()):
                cj = folder / "claim.json"
                if not cj.exists():
                    continue
                c = json.loads(cj.read_text())
                cur.execute("INSERT INTO claims VALUES (%s, %s, %s, false)", (c["claim_id"], Jsonb(c), c["filed_on"]))
                for bill_no in _pack_bill_numbers(folder):
                    cur.execute("INSERT INTO claim_bills VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                                (c["hospital_id"], bill_no, c["claim_id"]))
                for pdf in sorted(folder.glob("*.pdf")):
                    cur.execute("INSERT INTO documents (claim_id, filename, content) VALUES (%s, %s, %s)",
                                (c["claim_id"], pdf.name, pdf.read_bytes()))
                n += 1
    return {"claims": n, "policies": len(data["policies"])}
