"""The agent reaches the outside world only through these calls (httpx, explicit timeouts)."""
from __future__ import annotations

import time

import httpx

from harborline.config import get_settings

TIMEOUT = httpx.Timeout(10.0, connect=5.0)
PAYMENT_TIMEOUT = httpx.Timeout(5.0, connect=5.0)
READ_ATTEMPTS = 3  # reads only: a sleeping database can take >10 s to answer its first query


def _client(timeout=TIMEOUT) -> httpx.Client:
    return httpx.Client(base_url=get_settings().mock_base_url, timeout=timeout)


def _read(path: str, params: dict | None = None) -> httpx.Response:
    """GET with a short backoff on timeouts and dropped connections. GETs change nothing, so retrying is safe."""
    for attempt in range(READ_ATTEMPTS):
        try:
            with _client() as c:
                r = c.get(path, params=params or None)
            r.raise_for_status()
            return r
        except (httpx.TimeoutException, httpx.TransportError):
            if attempt == READ_ATTEMPTS - 1:
                raise
            time.sleep(1 + attempt * 2)
    raise AssertionError("unreachable")


def _get(path: str, **params):
    return _read(path, params).json()


def _post(path: str, body: dict, key: str):
    with _client() as c:
        r = c.post(path, json=body, headers={"Idempotency-Key": key})
        r.raise_for_status()
        return r.json()


# Policy
def get_policy(pid): return _get(f"/policies/{pid}")
def get_balance(pid): return _get(f"/policies/{pid}/balance")
def get_member(mid): return _get(f"/members/{mid}")
def get_hospital(hid): return _get(f"/hospitals/{hid}")

# Claims
def get_claim(cid): return _get(f"/claims/{cid}")
def find_claims_by_bill(bill_no, hospital_id): return _get("/claims", bill_no=bill_no, hospital_id=hospital_id)
def post_decision(cid, body, key): return _post(f"/claims/{cid}/decision", body, key)

# Documents
def list_documents(cid): return _get(f"/claims/{cid}/documents")


def get_document(cid, filename) -> bytes:
    return _read(f"/claims/{cid}/documents/{filename}").content


def upload_document(cid, filename, content: bytes):
    with _client() as c:
        r = c.post(f"/claims/{cid}/documents", files={"file": (filename, content, "application/pdf")})
        r.raise_for_status()
        return r.json()


# Email
def list_emails(cid): return _get("/emails", claim_id=cid)
def send_email(body, key): return _post("/emails", body, key)


# Payments
def list_payments(cid): return _get("/payments", claim_id=cid)


def create_payment(body: dict, key: str) -> dict:
    """May raise httpx.TimeoutException / HTTPStatusError: the caller must look again before retrying."""
    with _client(PAYMENT_TIMEOUT) as c:
        r = c.post("/payments", json=body, headers={"Idempotency-Key": key})
        r.raise_for_status()
        return r.json()
