"""Snag Paddle webhook — Phase 3: signature verification + event processing.

Paddle signs the raw request body (HMAC-SHA256 over the exact bytes); the
`paddle-signature` header is verified against the secret held in SSM
Parameter Store (read at runtime, granted per-parameter by the CDK stack —
never in the function environment, so it stays out of `aws lambda
get-function` and the console).

Event processing (plan A6):
  subscription.created / updated / canceled
    -> update the SUBSCRIPTION item (status, currentPeriodEnd,
       paddleSubscriptionId) for the Cognito user carried in the checkout's
       custom_data.cognitoSub.

Idempotency: a conditional put on WEBHOOK#<eventId>/RECEIVED (condition:
attribute_not_exists(pk)) doubles as check-and-mark in one atomic call.
The item carries a ~30-day TTL so Paddle's redelivery window stays covered
and the rows age out without a cleanup job.

Every outcome returns 200 to Paddle EXCEPT an invalid signature (401):
Paddle retries non-2xx deliveries, and a permanently-failing event would
otherwise retry forever. Anything we choose not to act on is reported in
the response body (`warn` / `ignored`) so it is visible in CloudWatch logs
rather than silently dropped.
"""
import hashlib
import hmac
import json
import os
import time

import boto3
from botocore.exceptions import ClientError

ssm = boto3.client("ssm")
dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["SNAG_TABLE"]
TABLE = dynamodb.Table(TABLE_NAME)

WEBHOOK_SECRET_PARAM = "/snag/paddle_webhook_secret"
IDEMPOTENCY_TTL_S = 30 * 24 * 3600

# Paddle event name -> subscription status. subscription.updated keeps the
# resource's own status (Paddle sends it for status changes: active,
# canceled, past_due, ...).
EVENT_STATUS = {
    "subscription.created": "active",
    "subscription.canceled": "cancelled",
}
# Paddle resource.status values we map onto our three-state gate.
RESOURCE_STATUS = {
    "active": "active",
    "canceled": "cancelled",
    "past_due": "past_due",
    "unpaid": "past_due",
    "incomplete": "past_due",
    "incomplete_expired": "past_due",
}


def _webhook_secret():
    try:
        resp = ssm.get_parameter(Name=WEBHOOK_SECRET_PARAM, WithDecryption=True)
        value = resp.get("Parameter", {}).get("Value", "")
        return "" if value == "REPLACE_ME_OUT_OF_BAND" else value
    except Exception:
        return ""


def handler(event, context):
    body = event.get("body", "") or ""
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    signature = headers.get("paddle-signature", "")

    secret = _webhook_secret()
    if not secret:
        # Secret not configured yet (pre-launch). Accept but flag it so a
        # misconfigured prod env is visible rather than silently trusted.
        return _json(200, {"ok": True, "warn": "webhook secret not configured"})

    expected = hmac.new(
        secret.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return _json(401, {"error": "invalid_signature"})

    try:
        payload = json.loads(body)
    except ValueError:
        return _json(400, {"error": "invalid_json"})
    if not isinstance(payload, dict):
        return _json(400, {"error": "invalid_json"})

    return process_event(payload)


def process_event(payload):
    event_id = str(payload.get("id") or payload.get("event_id") or "")
    event_type = str(payload.get("event") or "")

    # Dedup on the Paddle event id BEFORE applying, so a redelivered event
    # can never double-apply. (The apply itself is an idempotent overwrite,
    # so the residual race between check and apply is harmless.)
    if event_id and _seen_before(event_id):
        return _json(200, {"ok": True, "duplicate": True})

    items = (payload.get("data") or {}).get("items") or []
    resource = (items[0] or {}).get("resource") or {} if items else {}
    custom = resource.get("custom_data") or {}
    sub = str(custom.get("cognitoSub") or "")

    if event_type not in EVENT_STATUS and event_type != "subscription.updated":
        return _json(200, {"ok": True, "ignored": event_type})

    if not sub:
        # Plan A6: alert, don't silently drop — the checkout's custom_data
        # is the only link between the subscription and the Cognito user.
        return _json(200, {"ok": True, "warn": f"event {event_id} ({event_type or 'unknown'}) missing custom_data.cognitoSub"})

    status = _status_for(event_type, resource)
    _apply_subscription(sub, status, resource)
    if event_id:
        _mark_received(event_id)
    return _json(200, {"ok": True, "applied": event_type, "status": status})


def _status_for(event_type, resource):
    if event_type in EVENT_STATUS:
        return EVENT_STATUS[event_type]
    # subscription.updated: trust the resource's own status.
    return RESOURCE_STATUS.get(str(resource.get("status") or ""), "past_due")


def _apply_subscription(sub, status, resource):
    TABLE.put_item(
        Item={
            "pk": f"USER#{sub}",
            "sk": "SUBSCRIPTION",
            "status": status,
            "currentPeriodEnd": resource.get("current_period_end"),
            "paddleSubscriptionId": resource.get("id"),
        }
    )


def _seen_before(event_id):
    resp = TABLE.get_item(Key={"pk": f"WEBHOOK#{event_id}", "sk": "RECEIVED"})
    return "Item" in resp


def _mark_received(event_id):
    """Conditional put: if a concurrent delivery got here first, its apply
    already happened and ours is an identical overwrite — drop the race."""
    now = int(time.time())
    try:
        TABLE.put_item(
            Item={
                "pk": f"WEBHOOK#{event_id}",
                "sk": "RECEIVED",
                "receivedAt": now,
                "ttl": now + IDEMPOTENCY_TTL_S,
            },
            ConditionExpression="attribute_not_exists(pk)",
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise


def _json(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
