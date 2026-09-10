"""Unit tests for infra/lambdas/snag_api/main.py (boto3 + HTTP mocked)."""
import importlib.util
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError

LAMBDA_MAIN = Path(__file__).resolve().parents[1] / "lambdas" / "snag_api" / "main.py"


def _load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _ccf():
    """The ConditionalCheckFailedException DynamoDB raises on failed condition."""
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")


class _FakeTable:
    """Scripted update outcomes; records every call for assertions."""

    def __init__(self, items=None, update_results=None):
        self.items = items or {}
        self.updates = []
        self._update_results = list(update_results or [])

    def get_item(self, Key):
        item = self.items.get((Key["pk"], Key["sk"]))
        return {"Item": item} if item is not None else {}

    def update_item(self, Key, **kwargs):
        self.updates.append({"Key": Key, **kwargs})
        if not self._update_results:
            return {"Attributes": {}}
        outcome = self._update_results.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class _FakeSsm:
    def __init__(self, secrets=None):
        self.secrets = secrets or {}

    def get_parameter(self, Name, WithDecryption):
        name = Name.rsplit("/", 1)[-1]
        return {"Parameter": {"Value": self.secrets.get(name, "REPLACE_ME_OUT_OF_BAND")}}


@pytest.fixture()
def main(monkeypatch):
    # The Lambda reads SNAG_TABLE at import time and constructs boto3
    # clients immediately; both need env before exec_module.
    monkeypatch.setenv("SNAG_TABLE", "test-table")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    yield _load_module("snag_api_main", LAMBDA_MAIN)


def _patch_infra(monkeypatch, main, table=None, secrets=None):
    if table is not None:
        monkeypatch.setattr(main, "TABLE", table)
    monkeypatch.setattr(main, "ssm", _FakeSsm(secrets))


def _event(method, path, sub="user-1", email="a@b.c", body=None):
    claims = {"sub": sub, "email": email} if sub else {}
    return {
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {"claims": claims},
        },
        "body": json.dumps(body) if body is not None else None,
    }


def _body(resp):
    return json.loads(resp["body"])


def _active_sub_table():
    return _FakeTable({("USER#user-1", "SUBSCRIPTION"): {"status": "active"}})


# --- GET /api/me -------------------------------------------------------------

def test_get_me_with_active_subscription(main, monkeypatch):
    table = _FakeTable({("USER#user-1", "SUBSCRIPTION"): {"status": "active", "currentPeriodEnd": "2026-10-01T00:00:00Z"}})
    _patch_infra(monkeypatch, main, table=table)

    resp = main.handler(_event("GET", "/api/me"), None)

    assert resp["statusCode"] == 200
    assert _body(resp) == {
        "sub": "user-1",
        "email": "a@b.c",
        "subscriptionStatus": "active",
        "currentPeriodEnd": "2026-10-01T00:00:00Z",
    }


def test_get_me_without_subscription_item(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_FakeTable())

    resp = main.handler(_event("GET", "/api/me"), None)

    assert resp["statusCode"] == 200
    assert _body(resp)["subscriptionStatus"] == "none"
    assert _body(resp)["currentPeriodEnd"] is None


def test_get_me_without_sub_is_401(main, monkeypatch):
    def boom(name):
        raise AssertionError("table accessed without a sub")

    _patch_infra(monkeypatch, main, table=SimpleNamespace(get_item=boom))

    resp = main.handler(_event("GET", "/api/me", sub=""), None)

    assert resp["statusCode"] == 401
    assert _body(resp)["error"] == "unauthorized"


def test_unknown_path_is_404(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_FakeTable())

    resp = main.handler(_event("GET", "/api/nope"), None)

    assert resp["statusCode"] == 404
    assert _body(resp)["path"] == "/api/nope"


# --- POST /api/answer/generate -------------------------------------------------

def test_generate_requires_subscription(main, monkeypatch):
    for sk in (None, {"status": "cancelled"}):
        items = {("USER#user-1", "SUBSCRIPTION"): sk} if sk else {}
        table = _FakeTable(items)
        _patch_infra(monkeypatch, main, table=table)

        resp = main.handler(_event("POST", "/api/answer/generate", body={"prompt": "hi"}), None)

        assert resp["statusCode"] == 402
        assert _body(resp)["error"] == "subscription_required"
        assert table.updates == []  # no usage recorded for a denied call


def test_generate_without_sub_is_401(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_FakeTable())

    resp = main.handler(_event("POST", "/api/answer/generate", sub="", body={"prompt": "hi"}), None)

    assert resp["statusCode"] == 401


def test_generate_requires_prompt(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_active_sub_table())

    resp = main.handler(_event("POST", "/api/answer/generate", body={"prompt": "   "}), None)

    assert resp["statusCode"] == 400
    assert _body(resp)["error"] == "missing_prompt"


def test_generate_without_provider_key_is_503(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_active_sub_table(), secrets={})

    resp = main.handler(
        _event("POST", "/api/answer/generate", body={"prompt": "Tell me about yourself"}), None)

    assert resp["statusCode"] == 503
    assert _body(resp)["error"] == "provider_not_configured"


def test_generate_streams_sse_from_anthropic_chunks(main, monkeypatch):
    table = _active_sub_table()
    _patch_infra(monkeypatch, main, table=table, secrets={"anthropic_api_key": "k-ant"})

    seen = {}

    def fake_stream(api_key, system, prompt):
        seen.update(api_key=api_key, system=system, prompt=prompt)
        return ["I shipped ", "snag."], None

    monkeypatch.setattr(main, "_anthropic_stream", fake_stream)

    resp = main.handler(
        _event("POST", "/api/answer/generate",
               body={"systemPrompt": "sys", "prompt": "Tell me about yourself", "question": "Tell me about yourself"}),
        None,
    )

    assert resp["statusCode"] == 200
    assert resp["headers"]["Content-Type"] == "text/event-stream"
    assert 'data: {"text": "I shipped "}' in resp["body"]
    assert 'data: {"text": "snag."}' in resp["body"]
    assert resp["body"].endswith("data: [DONE]\n\n")
    assert seen == {"api_key": "k-ant", "system": "sys", "prompt": "Tell me about yourself"}
    # Usage was recorded before the provider call.
    assert len(table.updates) == 1


def test_generate_provider_error_is_502(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_active_sub_table(), secrets={"anthropic_api_key": "k-ant"})
    monkeypatch.setattr(main, "_anthropic_stream", lambda k, s, p: (None, (502, "provider error 429 overloaded")))

    resp = main.handler(_event("POST", "/api/answer/generate", body={"prompt": "x"}), None)

    assert resp["statusCode"] == 502
    assert "provider error 429" in _body(resp)["error"]


def test_generate_daily_cap_is_429_with_resets_at(main, monkeypatch):
    table = _FakeTable(
        {("USER#user-1", "SUBSCRIPTION"): {"status": "active"}},
        update_results=[{"Attributes": {"generateDayCount": 301}}],
    )
    _patch_infra(monkeypatch, main, table=table, secrets={"anthropic_api_key": "k-ant"})

    resp = main.handler(_event("POST", "/api/answer/generate", body={"prompt": "x"}), None)

    assert resp["statusCode"] == 429
    err = _body(resp)
    assert err["error"] == "rate_limited"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", err["resetsAt"])


def test_generate_bumps_usage_atomically_same_day(main, monkeypatch):
    import datetime

    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    this_month = today[:7]
    table = _FakeTable(
        {("USER#user-1", "SUBSCRIPTION"): {"status": "active"}},
        update_results=[{"Attributes": {"generateDayCount": 1}}],
    )
    _patch_infra(monkeypatch, main, table=table, secrets={"anthropic_api_key": "k-ant"})
    monkeypatch.setattr(main, "_anthropic_stream", lambda k, s, p: (["ok"], None))

    resp = main.handler(_event("POST", "/api/answer/generate", body={"prompt": "x"}), None)

    assert resp["statusCode"] == 200
    assert len(table.updates) == 1
    update = table.updates[0]
    assert update["Key"] == {"pk": "USER#user-1", "sk": f"USAGE#{this_month}"}
    assert update["ConditionExpression"] == "generateDay = :today"
    assert update["ExpressionAttributeValues"]["today"] == today
    assert update["ReturnValues"] == "UPDATED_NEW"
    assert "generateCount = generateCount + :one" in update["UpdateExpression"]


def test_generate_day_boundary_rebaselines_then_counts(main, monkeypatch):
    table = _FakeTable(
        {("USER#user-1", "SUBSCRIPTION"): {"status": "active"}},
        update_results=[_ccf(), {"Attributes": {"generateDayCount": 1}}],
    )
    _patch_infra(monkeypatch, main, table=table, secrets={"anthropic_api_key": "k-ant"})
    monkeypatch.setattr(main, "_anthropic_stream", lambda k, s, p: (["ok"], None))

    resp = main.handler(_event("POST", "/api/answer/generate", body={"prompt": "x"}), None)

    assert resp["statusCode"] == 200
    assert len(table.updates) == 2
    first, second = table.updates
    assert first["ConditionExpression"] == "generateDay = :today"
    assert second["ConditionExpression"] == "attribute_not_exists(generateDay) OR generateDay <> :today"
    assert "generateDay = :today" in second["UpdateExpression"]


# --- POST /api/embed -----------------------------------------------------------

def test_embed_requires_subscription(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_FakeTable())

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 402


def test_embed_requires_text(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_active_sub_table())

    resp = main.handler(_event("POST", "/api/embed", body={"text": ""}), None)

    assert resp["statusCode"] == 400
    assert _body(resp)["error"] == "missing_text"


def test_embed_without_provider_key_is_503(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_active_sub_table(), secrets={})

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 503


def test_embed_returns_openai_vector(main, monkeypatch):
    table = _active_sub_table()
    _patch_infra(monkeypatch, main, table=table, secrets={"openai_api_key": "k-oai"})

    seen = {}

    def fake_http_json(url, payload, headers, timeout=None):
        seen.update(url=url, payload=payload, headers=headers)
        return {"data": [{"embedding": [0.1, -0.2, 0.3]}]}

    monkeypatch.setattr(main, "_http_json", fake_http_json)

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 200
    assert _body(resp) == {"embedding": [0.1, -0.2, 0.3]}
    assert seen["url"] == "https://api.openai.com/v1/embeddings"
    assert seen["payload"]["model"] == "text-embedding-3-small"
    assert seen["payload"]["input"] == "hello"
    assert seen["headers"]["Authorization"] == "Bearer k-oai"
    assert len(table.updates) == 1
    assert "embedCount = embedCount + :one" in table.updates[0]["UpdateExpression"]


def test_embed_provider_error_is_502(main, monkeypatch):
    import urllib.error

    class _FakeHTTPError(urllib.error.HTTPError):
        def __init__(self):
            super().__init__("https://api.openai.com/v1/embeddings", 401, "unauthorized", {}, None)

    _patch_infra(monkeypatch, main, table=_active_sub_table(), secrets={"openai_api_key": "k-oai"})
    monkeypatch.setattr(main, "_http_json", lambda *a, **k: (_ for _ in ()).throw(_FakeHTTPError()))

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 502
