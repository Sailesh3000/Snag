"""Unit tests for infra/lambdas/snag_api/main.py (boto3 mocked).

LLM generation is BYOK (extension calls Anthropic/OpenAI directly) — this
backend only ever does a license check (/api/me) and Bedrock-backed
embeddings (/api/embed), so there is no provider-key/SSM surface to test
here at all; Bedrock is IAM-only.
"""
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


@pytest.fixture()
def main(monkeypatch):
    # The Lambda reads SNAG_TABLE at import time and constructs boto3
    # clients immediately; both need env before exec_module.
    monkeypatch.setenv("SNAG_TABLE", "test-table")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    yield _load_module("snag_api_main", LAMBDA_MAIN)


def _patch_infra(monkeypatch, main, table=None):
    if table is not None:
        monkeypatch.setattr(main, "TABLE", table)


def _event(method, path, sub="user-1", email="a@b.c", body=None):
    claims = {"sub": sub, "email": email} if sub else {}
    return {
        "requestContext": {
            "http": {"method": method, "path": path},
            # HTTP API's JWT authorizer nests claims under "jwt" — not the
            # flatter shape a REST API/v1 custom authorizer would use.
            "authorizer": {"jwt": {"claims": claims}},
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


def test_get_me_reports_active_for_a_free_allowlisted_email_with_no_real_subscription(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_FakeTable())  # no SUBSCRIPTION item at all

    resp = main.handler(_event("GET", "/api/me", email="chandrasailesh30@gmail.com"), None)

    assert resp["statusCode"] == 200
    assert _body(resp)["subscriptionStatus"] == "active"


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


# --- POST /api/embed -----------------------------------------------------------

def test_embed_requires_subscription(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_FakeTable())

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 402


def test_embed_bypasses_the_gate_for_a_free_allowlisted_email(main, monkeypatch):
    table = _FakeTable()  # no SUBSCRIPTION item — would 402 for anyone else
    _patch_infra(monkeypatch, main, table=table)
    monkeypatch.setattr(main, "_titan_embed", lambda text: ([0.1], None))

    resp = main.handler(_event("POST", "/api/embed", email="chandrasailesh30@gmail.com", body={"text": "hello"}), None)

    assert resp["statusCode"] == 200
    assert _body(resp) == {"embedding": [0.1]}


def test_embed_requires_text(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_active_sub_table())

    resp = main.handler(_event("POST", "/api/embed", body={"text": ""}), None)

    assert resp["statusCode"] == 400
    assert _body(resp)["error"] == "missing_text"


def test_embed_returns_bedrock_titan_vector(main, monkeypatch):
    table = _active_sub_table()
    _patch_infra(monkeypatch, main, table=table)

    seen = {}

    def fake_titan_embed(text):
        seen["text"] = text
        return [0.1, -0.2, 0.3], None

    monkeypatch.setattr(main, "_titan_embed", fake_titan_embed)

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 200
    assert _body(resp) == {"embedding": [0.1, -0.2, 0.3]}
    assert seen["text"] == "hello"
    assert len(table.updates) == 1
    assert "embedCount = embedCount + :one" in table.updates[0]["UpdateExpression"]


def test_embed_provider_error_is_502(main, monkeypatch):
    _patch_infra(monkeypatch, main, table=_active_sub_table())
    monkeypatch.setattr(main, "_titan_embed", lambda text: (None, (502, "bedrock error AccessDeniedException: nope")))

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 502
    assert "bedrock error" in _body(resp)["error"]


def test_embed_daily_cap_is_429_with_resets_at(main, monkeypatch):
    table = _FakeTable(
        {("USER#user-1", "SUBSCRIPTION"): {"status": "active"}},
        update_results=[{"Attributes": {"embedDayCount": 501}}],
    )
    _patch_infra(monkeypatch, main, table=table)

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 429
    err = _body(resp)
    assert err["error"] == "rate_limited"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", err["resetsAt"])


def test_embed_bumps_usage_atomically_same_day(main, monkeypatch):
    import datetime

    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    this_month = today[:7]
    table = _FakeTable(
        {("USER#user-1", "SUBSCRIPTION"): {"status": "active"}},
        update_results=[{"Attributes": {"embedDayCount": 1}}],
    )
    _patch_infra(monkeypatch, main, table=table)
    monkeypatch.setattr(main, "_titan_embed", lambda text: ([0.0], None))

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 200
    assert len(table.updates) == 1
    update = table.updates[0]
    assert update["Key"] == {"pk": "USER#user-1", "sk": f"USAGE#{this_month}"}
    assert update["ConditionExpression"] == "embedDay = :today"
    assert update["ExpressionAttributeValues"]["today"] == today
    assert update["ReturnValues"] == "UPDATED_NEW"


def test_embed_day_boundary_rebaselines_then_counts(main, monkeypatch):
    table = _FakeTable(
        {("USER#user-1", "SUBSCRIPTION"): {"status": "active"}},
        update_results=[_ccf(), {"Attributes": {"embedDayCount": 1}}],
    )
    _patch_infra(monkeypatch, main, table=table)
    monkeypatch.setattr(main, "_titan_embed", lambda text: ([0.0], None))

    resp = main.handler(_event("POST", "/api/embed", body={"text": "hello"}), None)

    assert resp["statusCode"] == 200
    assert len(table.updates) == 2
    first, second = table.updates
    assert first["ConditionExpression"] == "embedDay = :today"
    assert second["ConditionExpression"] == "attribute_not_exists(embedDay) OR embedDay <> :today"
    assert "embedDay = :today" in second["UpdateExpression"]
