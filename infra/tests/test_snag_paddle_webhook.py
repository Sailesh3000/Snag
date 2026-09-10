"""Unit tests for infra/lambdas/snag_paddle_webhook/main.py (SSM mocked)."""
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path

import pytest

LAMBDA_MAIN = Path(__file__).resolve().parents[1] / "lambdas" / "snag_paddle_webhook" / "main.py"
SECRET = "whsec_test_secret"


def _load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def main(monkeypatch):
    # The Lambda constructs boto3 clients and reads SNAG_TABLE at import
    # time; both need env before exec_module.
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("SNAG_TABLE", "test-table")
    yield _load_module("paddle_webhook_main", LAMBDA_MAIN)


class _FakeTable:
    def __init__(self, items=None):
        self.items = items or {}
        self.puts = []

    def get_item(self, Key):
        item = self.items.get((Key["pk"], Key["sk"]))
        return {"Item": item} if item is not None else {}

    def put_item(self, Item, ConditionExpression=None):
        self.puts.append({"Item": Item, "ConditionExpression": ConditionExpression})
        if ConditionExpression == "attribute_not_exists(pk)" and (Item["pk"], Item["sk"]) in self.items:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem")
        self.items[(Item["pk"], Item["sk"])] = Item


class _FakeSsm:
    def __init__(self, value=None, exc=None):
        self._value = value
        self._exc = exc

    def get_parameter(self, Name, WithDecryption):
        assert Name == "/snag/paddle_webhook_secret"
        assert WithDecryption is True
        if self._exc:
            raise self._exc
        return {"Parameter": {"Value": self._value}}


def _patch_secret(monkeypatch, main, value=None, exc=None):
    monkeypatch.setattr(main, "ssm", _FakeSsm(value=value, exc=exc))


def _event(body, signature=None, header_name="paddle-signature"):
    headers = {}
    if signature is not None:
        headers[header_name] = signature
    return {"body": body, "headers": headers}


def _sig(body):
    return hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()


def _body(resp):
    return json.loads(resp["body"])


def test_valid_signature_accepted(main, monkeypatch):
    monkeypatch.setattr(main, "TABLE", _FakeTable())
    _patch_secret(monkeypatch, main, value=SECRET)
    body = json.dumps({"id": "evt_1", "event_type": "subscription.created"})

    resp = main.handler(_event(body, signature=_sig(body)), None)

    assert resp["statusCode"] == 200
    assert _body(resp)["ok"] is True


def test_invalid_signature_rejected(main, monkeypatch):
    _patch_secret(monkeypatch, main, value=SECRET)

    resp = main.handler(_event("{}", signature="deadbeef"), None)

    assert resp["statusCode"] == 401
    assert _body(resp)["error"] == "invalid_signature"


def test_missing_signature_rejected(main, monkeypatch):
    _patch_secret(monkeypatch, main, value=SECRET)

    resp = main.handler(_event("{}"), None)

    assert resp["statusCode"] == 401


def test_header_name_is_case_insensitive(main, monkeypatch):
    _patch_secret(monkeypatch, main, value=SECRET)
    body = "{}"

    resp = main.handler(_event(body, signature=_sig(body), header_name="Paddle-Signature"), None)

    assert resp["statusCode"] == 200


def test_signature_over_empty_body_is_rejected(main, monkeypatch):
    # Guard against an attacker omitting the body while replaying a signature
    # computed over a different payload.
    _patch_secret(monkeypatch, main, value=SECRET)

    resp = main.handler(_event("", signature=_sig('{"id":"x"}')), None)

    assert resp["statusCode"] == 401


def test_unset_secret_is_200_with_warning(main, monkeypatch):
    _patch_secret(monkeypatch, main, value="REPLACE_ME_OUT_OF_BAND")

    resp = main.handler(_event("{}"), None)

    assert resp["statusCode"] == 200
    assert "warn" in _body(resp)


def test_ssm_error_is_200_with_warning(main, monkeypatch):
    _patch_secret(monkeypatch, main, exc=RuntimeError("no perms"))

    resp = main.handler(_event("{}"), None)

    assert resp["statusCode"] == 200
    assert "warn" in _body(resp)


def _paddle_event(event_id, event_type, sub="user-1", status="active", period="2026-10-01T00:00:00Z", sub_id="sub_123"):
    return {
        "id": event_id,
        "event": event_type,
        "data": {
            "items": [
                {
                    "resource": {
                        "id": sub_id,
                        "status": status,
                        "current_period_end": period,
                        "custom_data": {"cognitoSub": sub},
                    }
                }
            ]
        },
    }


def _signed(main, monkeypatch, payload, table=None):
    _patch_secret(monkeypatch, main, value=SECRET)
    if table is not None:
        monkeypatch.setattr(main, "TABLE", table)
    body = json.dumps(payload)
    return main.handler(_event(body, signature=_sig(body)), None)


def test_subscription_created_applies_and_marks(main, monkeypatch):
    table = _FakeTable()
    resp = _signed(main, monkeypatch, _paddle_event("evt_1", "subscription.created"), table)

    assert resp["statusCode"] == 200
    assert _body(resp) == {"ok": True, "applied": "subscription.created", "status": "active"}

    sub_item = table.items[("USER#user-1", "SUBSCRIPTION")]
    assert sub_item["status"] == "active"
    assert sub_item["currentPeriodEnd"] == "2026-10-01T00:00:00Z"
    assert sub_item["paddleSubscriptionId"] == "sub_123"

    webhook_put = [p for p in table.puts if p["Item"]["sk"] == "RECEIVED"][0]
    assert webhook_put["Item"]["pk"] == "WEBHOOK#evt_1"
    assert webhook_put["ConditionExpression"] == "attribute_not_exists(pk)"
    assert webhook_put["Item"]["ttl"] > webhook_put["Item"]["receivedAt"]


def test_redelivered_event_is_duplicate(main, monkeypatch):
    table = _FakeTable()
    payload = _paddle_event("evt_1", "subscription.created")

    first = _signed(main, monkeypatch, payload, table)
    second = _signed(main, monkeypatch, payload, table)

    assert _body(first)["applied"] == "subscription.created"
    assert _body(second) == {"ok": True, "duplicate": True}
    # Applied exactly once.
    sub_puts = [p for p in table.puts if p["Item"]["sk"] == "SUBSCRIPTION"]
    assert len(sub_puts) == 1


def test_subscription_updated_uses_resource_status(main, monkeypatch):
    table = _FakeTable()
    resp = _signed(main, monkeypatch, _paddle_event("evt_2", "subscription.updated", status="past_due"), table)

    assert _body(resp)["status"] == "past_due"
    assert table.items[("USER#user-1", "SUBSCRIPTION")]["status"] == "past_due"


def test_subscription_canceled_sets_cancelled(main, monkeypatch):
    table = _FakeTable()
    resp = _signed(main, monkeypatch, _paddle_event("evt_3", "subscription.canceled", status="canceled"), table)

    assert _body(resp)["status"] == "cancelled"
    assert table.items[("USER#user-1", "SUBSCRIPTION")]["status"] == "cancelled"


def test_unknown_resource_status_defaults_to_past_due(main, monkeypatch):
    table = _FakeTable()
    resp = _signed(main, monkeypatch, _paddle_event("evt_4", "subscription.updated", status="something_new"), table)

    assert _body(resp)["status"] == "past_due"


def test_missing_cognito_sub_warns_instead_of_applying(main, monkeypatch):
    table = _FakeTable()
    payload = _paddle_event("evt_5", "subscription.created")
    del payload["data"]["items"][0]["resource"]["custom_data"]["cognitoSub"]

    resp = _signed(main, monkeypatch, payload, table)

    assert resp["statusCode"] == 200
    assert "missing custom_data.cognitoSub" in _body(resp)["warn"]
    assert table.items == {}  # nothing applied, nothing marked


def test_unknown_event_type_is_ignored(main, monkeypatch):
    table = _FakeTable()
    resp = _signed(main, monkeypatch, _paddle_event("evt_6", "transaction.activated"), table)

    assert _body(resp) == {"ok": True, "ignored": "transaction.activated"}
    assert table.puts == []


def test_event_without_id_still_applies(main, monkeypatch):
    table = _FakeTable()
    payload = _paddle_event(None, "subscription.created")
    payload["id"] = ""

    resp = _signed(main, monkeypatch, payload, table)

    assert _body(resp)["applied"] == "subscription.created"
    assert table.items[("USER#user-1", "SUBSCRIPTION")]["status"] == "active"
    assert all(p["Item"]["sk"] != "RECEIVED" for p in table.puts)


def test_signed_but_invalid_json_is_400(main, monkeypatch):
    _patch_secret(monkeypatch, main, value=SECRET)

    resp = main.handler(_event("{not json", signature=_sig("{not json")), None)

    assert resp["statusCode"] == 400
    assert _body(resp)["error"] == "invalid_json"
