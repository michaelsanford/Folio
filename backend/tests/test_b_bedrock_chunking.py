"""Bedrock: cached client with bounded timeouts, chunked parallel calls, per-chunk failure."""
import json
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from app.core.config import settings
from app.services.categorization import bedrock_classifier as bc


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", True)
    bc.reset_bedrock_client_cache()
    yield
    bc.reset_bedrock_client_cache()


CATS = [{"slug": "groceries", "name": "Groceries", "id": "c1", "type": "EXPENSE"}]


def _reply(prompt_text: str, fail_marker: str | None = None):
    """Answer every transaction in the prompt, or garbage if the chunk holds fail_marker."""
    payload = prompt_text.split("Transactions to Classify:\n", 1)[1].split("\n\nInstructions", 1)[0]
    txns = json.loads(payload)
    if fail_marker and any(t["raw_payee"] == fail_marker for t in txns):
        text = "not json at all"
    else:
        text = json.dumps([
            {"index": t["index"], "category_slug": "groceries", "confidence": 0.9,
             "reasoning": t["raw_payee"], "normalized_payee": t["raw_payee"].title()}
            for t in txns
        ])
    return {"output": {"message": {"content": [{"text": text}]}}}


def test_client_config_bounds_latency():
    cfg = bc.BEDROCK_CLIENT_CONFIG
    assert cfg.connect_timeout == 3
    assert cfg.read_timeout == 12
    assert cfg.retries == {"max_attempts": 1, "mode": "standard"}
    assert bc.BATCH_DEADLINE_SECONDS == 20.0


def test_client_is_cached_per_region():
    with patch("boto3.client", side_effect=lambda *a, **k: MagicMock()) as mock_boto:
        a = bc.get_bedrock_client("ca-central-1")
        b = bc.get_bedrock_client("ca-central-1")
        c = bc.get_bedrock_client("us-east-1")
    assert a is b and a is not c
    assert mock_boto.call_count == 2
    assert mock_boto.call_args.kwargs["config"] is bc.BEDROCK_CLIENT_CONFIG


def test_batch_is_chunked_and_order_preserved():
    calls = []
    lock = threading.Lock()

    def converse(**kwargs):
        prompt = kwargs["messages"][0]["content"][0]["text"]
        with lock:
            calls.append(prompt)
        return _reply(prompt)

    client = MagicMock()
    client.converse.side_effect = converse
    txns = [{"raw_payee": f"SHOP {i}", "amount": -1.0} for i in range(95)]
    with patch("boto3.client", return_value=client):
        results = bc.classify_with_bedrock(txns, CATS)

    assert len(calls) == 3  # 40 + 40 + 15
    assert len(results) == 95
    assert [r.reasoning for r in results] == [t["raw_payee"] for t in txns]


def test_parse_failure_loses_only_that_chunk():
    client = MagicMock()
    client.converse.side_effect = lambda **kw: _reply(kw["messages"][0]["content"][0]["text"], fail_marker="SHOP 45")
    txns = [{"raw_payee": f"SHOP {i}", "amount": -1.0} for i in range(100)]
    with patch("boto3.client", return_value=client):
        results = bc.classify_with_bedrock(txns, CATS)

    assert len(results) == 100
    # Chunk 2 (rows 40-79) held the poisoned row: zero confidence there only.
    assert all(r.confidence == 0.0 for r in results[40:80])
    assert all(r.confidence == 0.9 for r in results[:40] + results[80:])


def test_all_chunks_failing_returns_empty():
    client = MagicMock()
    client.converse.return_value = {"output": {"message": {"content": [{"text": "nope"}]}}}
    with patch("boto3.client", return_value=client):
        assert bc.classify_with_bedrock([{"raw_payee": f"X{i}"} for i in range(50)], CATS) == []


def test_slow_chunks_are_cut_off_at_the_deadline(monkeypatch):
    """A chunk still running at the deadline leaves its rows unclassified, and
    the call returns without waiting for it."""
    monkeypatch.setattr(bc, "BATCH_DEADLINE_SECONDS", 0.3)
    release = threading.Event()

    def converse(**kwargs):
        prompt = kwargs["messages"][0]["content"][0]["text"]
        if '"raw_payee": "SLOW 40"' in prompt:
            release.wait(5)  # far beyond the deadline
        return _reply(prompt)

    client = MagicMock()
    client.converse.side_effect = converse
    txns = [{"raw_payee": f"FAST {i}", "amount": -1.0} for i in range(40)]
    txns += [{"raw_payee": f"SLOW {i}", "amount": -1.0} for i in range(40, 80)]
    try:
        with patch("boto3.client", return_value=client):
            started = time.monotonic()
            results = bc.classify_with_bedrock(txns, CATS)
            elapsed = time.monotonic() - started
    finally:
        release.set()

    assert elapsed < 2.0, f"classify_with_bedrock blocked for {elapsed:.2f}s past its deadline"
    assert len(results) == 80
    assert all(r.confidence == 0.9 for r in results[:40])
    assert all(r.confidence == 0.0 for r in results[40:]), "late rows stay uncategorised"


def test_a_single_slow_chunk_returns_nothing_by_the_deadline(monkeypatch):
    monkeypatch.setattr(bc, "BATCH_DEADLINE_SECONDS", 0.2)
    release = threading.Event()
    client = MagicMock()
    client.converse.side_effect = lambda **kw: release.wait(5) and _reply(kw["messages"][0]["content"][0]["text"])
    try:
        with patch("boto3.client", return_value=client):
            started = time.monotonic()
            results = bc.classify_with_bedrock([{"raw_payee": "SLOW"}], CATS)
            elapsed = time.monotonic() - started
    finally:
        release.set()
    assert elapsed < 1.5
    assert results == [], "every chunk missed the deadline: nothing classified"
