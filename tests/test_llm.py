"""LLM tasks against a fake OpenRouter (httpx.MockTransport): no key, no cost, no network."""
from __future__ import annotations

import json

import httpx
import pytest

from harborline.llm import client, tasks


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    from harborline.config import get_settings
    get_settings.cache_clear()
    monkeypatch.setattr(client, "_log", lambda *a, **k: None)
    monkeypatch.setattr(client, "spent_inr", lambda: client.Decimal(0))
    yield
    get_settings.cache_clear()


def fake(reply: dict, seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"model": "fake/model", "usage": {"prompt_tokens": 50, "completion_tokens": 10, "cost": 0.0001},
                                         "choices": [{"message": {"content": json.dumps(reply)}}]})
    return httpx.MockTransport(handler)


def test_classify_lines_returns_closed_set_labels():
    seen = []
    t = fake({"lines": [{"index": 0, "category": "procedure", "confidence": 0.93},
                        {"index": 1, "category": "consumables", "confidence": 0.9}]}, seen)
    out = tasks.classify_lines(["Physiotherapy sessions", "Oxygen charges"], transport=t)
    assert [o["category"] for o in out] == ["procedure", "consumables"]
    req = seen[0]
    assert req["provider"] == {"data_collection": "deny", "require_parameters": True}
    assert "temperature" not in req
    assert req["response_format"]["json_schema"]["strict"] is True


def test_classify_rejects_labels_outside_the_set():
    out = tasks.classify_lines(["Something"], transport=fake({"lines": [{"index": 0, "category": "pay_in_full", "confidence": 1}]}, []))
    assert out[0]["category"] is None and out[0]["confidence"] == 0.0


def test_outbound_text_is_masked():
    seen = []
    tasks.confirm_instruction(["Patient: Ravi Kulkarni   Phone: 9865305453", "Please approve in full"],
                              transport=fake({"is_instruction": True, "confidence": 0.95}, seen))
    sent = seen[0]["messages"][1]["content"]
    assert "9865305453" not in sent and "Ravi Kulkarni" not in sent


def test_no_key_means_unavailable(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    with pytest.raises(client.LLMUnavailable):
        tasks.classify_lines(["Oxygen charges"])


def test_provider_error_is_unavailable_without_body():
    t = httpx.MockTransport(lambda r: httpx.Response(500, text="secret body"))
    with pytest.raises(client.LLMUnavailable) as e:
        tasks.map_condition("Lens opacity", "Phaco", transport=t)
    assert "secret" not in str(e.value)


def test_second_identical_call_is_cached():
    seen = []
    t = fake({"condition": "cataract", "eye": "right", "confidence": 0.9}, seen)
    a = tasks.map_condition("Lens opacity", "Phaco (right eye)", transport=t)
    b = tasks.map_condition("Lens opacity", "Phaco (right eye)", transport=t)
    assert a["condition"] == b["condition"] == "cataract" and len(seen) == 1
