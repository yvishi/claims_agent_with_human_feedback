"""PII vault: placeholder -> real value, encrypted with Fernet (PII_VAULT_KEY from env).

Week 2 kept the token map in memory only. Claims wait for days and survive restarts, so the map
lives in Postgres, encrypted, and the claim's rows are deleted at CLOSED.
"""
from __future__ import annotations

import os

from cryptography.fernet import Fernet

from harborline import store

SCHEMA = """CREATE TABLE IF NOT EXISTS pii_vault (
  claim_id text NOT NULL, placeholder text NOT NULL, value_encrypted bytea NOT NULL,
  PRIMARY KEY (claim_id, placeholder));"""


def _fernet() -> Fernet:
    key = os.getenv("PII_VAULT_KEY")
    if not key:
        raise RuntimeError("PII_VAULT_KEY is not set")
    return Fernet(key.encode())


def put(claim_id: str, mapping: dict[str, str]) -> None:
    if not mapping:
        return
    f = _fernet()
    with store.connect() as conn:
        conn.execute(SCHEMA)
        with conn.cursor() as cur:
            cur.executemany("""INSERT INTO pii_vault VALUES (%s,%s,%s)
                               ON CONFLICT (claim_id, placeholder) DO NOTHING""",
                            [(claim_id, k, f.encrypt(v.encode())) for k, v in mapping.items()])


def get(claim_id: str) -> dict[str, str]:
    f = _fernet()
    with store.connect() as conn:
        conn.execute(SCHEMA)
        rows = conn.execute("SELECT placeholder, value_encrypted FROM pii_vault WHERE claim_id=%s",
                            (claim_id,)).fetchall()
    return {p: f.decrypt(bytes(v)).decode() for p, v in rows}


def unmask(claim_id: str, text: str) -> str:
    for placeholder, value in sorted(get(claim_id).items(), key=lambda kv: -len(kv[0])):
        text = text.replace(placeholder, value)
    return text


def delete(claim_id: str) -> None:
    with store.connect() as conn:
        conn.execute(SCHEMA)
        conn.execute("DELETE FROM pii_vault WHERE claim_id=%s", (claim_id,))
