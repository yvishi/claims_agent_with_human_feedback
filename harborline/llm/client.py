"""OpenRouter client. The only place that talks to a hosted model.

- Inputs are masked again right before sending (last guard), so nothing personal leaves.
- provider.data_collection = "deny": only providers that neither store nor train on prompts.
- Strict JSON schema output; require_parameters so a provider that ignores the schema is skipped.
- No temperature (claude-haiku-5.5 rejects sampling parameters; week-2 finding).
- Every call is logged in llm_calls (claim, purpose, tokens, cost) and cached by input hash,
  so re-runs after a crash are free. A hard budget cap refuses calls once spend reaches it.
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from decimal import Decimal

import httpx

from harborline import store
from harborline.config import get_settings
from harborline.privacy.masker import mask

BASE_URL = "https://openrouter.ai/api/v1"
TIMEOUT = httpx.Timeout(45.0, connect=10.0)
USD_TO_INR = Decimal(os.getenv("USD_TO_INR", "85"))

SCHEMA = """CREATE TABLE IF NOT EXISTS llm_calls (
  id bigserial PRIMARY KEY, claim_id text, purpose text NOT NULL, model text, prompt_version text,
  input_hash text, prompt_tokens int, completion_tokens int, cost_usd numeric(12,6), cached boolean,
  at timestamptz NOT NULL DEFAULT now());"""


class LLMUnavailable(Exception):
    """No key, over budget, or the provider failed. Callers fall back to the safe path (review)."""


@dataclass
class LLMResult:
    data: dict
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: Decimal
    cached: bool


def model_name() -> str:
    return os.getenv("LLM_MODEL", "anthropic/claude-haiku-5.5")


def budget_inr() -> Decimal:
    return Decimal(os.getenv("LLM_BUDGET_INR", "2500"))


def spent_inr() -> Decimal:
    with store.connect() as conn:
        conn.execute(SCHEMA)
        usd = conn.execute("SELECT COALESCE(sum(cost_usd), 0) FROM llm_calls").fetchone()[0]
    return Decimal(usd) * USD_TO_INR


def _log(claim_id, purpose, prompt_version, input_hash, res: LLMResult) -> None:
    with store.connect() as conn:
        conn.execute(SCHEMA)
        conn.execute("""INSERT INTO llm_calls (claim_id, purpose, model, prompt_version, input_hash, prompt_tokens,
                        completion_tokens, cost_usd, cached) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                     (claim_id, purpose, res.model, prompt_version, input_hash, res.prompt_tokens,
                      res.completion_tokens, res.cost_usd, res.cached))


def complete_json(*, purpose: str, prompt_version: str, system: str, user: str, schema: dict,
                  claim_id: str | None = None, transport: httpx.BaseTransport | None = None) -> LLMResult:
    key = os.getenv("LLM_API_KEY", "")
    if not key and transport is None:
        raise LLMUnavailable("LLM_API_KEY not set")
    user = mask(user).text  # last guard: never send unmasked text
    model = model_name()
    input_hash = hashlib.sha256(json.dumps([model, prompt_version, system, user, schema]).encode()).hexdigest()
    cache = get_settings().cache_dir / "llm" / f"{input_hash}.json"
    if cache.exists():
        res = LLMResult(json.loads(cache.read_text()), model, 0, 0, Decimal(0), True)
        _log(claim_id, purpose, prompt_version, input_hash, res)
        return res
    if spent_inr() >= budget_inr():
        raise LLMUnavailable("LLM budget reached")
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": 1500,
        "reasoning": {"effort": "low"},
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": purpose, "strict": True, "schema": schema}},
        "provider": {"data_collection": "deny", "require_parameters": True},
        "usage": {"include": True},
    }
    headers = {"Authorization": f"Bearer {key}", "X-Title": "Harborline claims agent"}
    try:
        with httpx.Client(timeout=TIMEOUT, transport=transport) as c:
            r = c.post(BASE_URL + "/chat/completions", json=payload, headers=headers)
            r.raise_for_status()
            body = r.json()
        data = json.loads(body["choices"][0]["message"]["content"])
    except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as e:
        raise LLMUnavailable(f"LLM call failed: {type(e).__name__}") from None  # no bodies in errors
    usage = body.get("usage") or {}
    res = LLMResult(data, body.get("model", model), int(usage.get("prompt_tokens", 0)),
                    int(usage.get("completion_tokens", 0)), Decimal(str(usage.get("cost", 0))), False)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data))
    _log(claim_id, purpose, prompt_version, input_hash, res)
    return res
