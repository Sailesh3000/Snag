"""Snag API — Phase 2 (revised): license gate + Bedrock-backed embeddings only.

LLM *generation* is BYOK again — the extension calls Anthropic/OpenAI
directly with the user's own key (extension/src/llm/client.ts), so this
backend never spends money on tokens and holds no LLM provider key at all.
The $5/month subscription instead gates (a) using Snag at all — a plain
license check — and (b) the one thing still worth centralizing: semantic
"similar past answers" memory matching, via Amazon Bedrock Titan
Embeddings, which is IAM-only (no external API key, no per-user secret)
and cheap enough for one subscription to fund many users' usage.

Routes (the API Gateway Cognito JWT authorizer validates the access token
before anything reaches this Lambda; verified claims arrive in
event["requestContext"]["authorizer"]["claims"], and `sub` is the only
per-user key the backend ever needs):

  GET  /api/me      -> {sub, email, subscriptionStatus, currentPeriodEnd}
  POST /api/embed    -> {"embedding": [...]} (Bedrock Titan Text Embeddings v2)

Gating (revised A4): no `status == "active"` SUBSCRIPTION item on /api/embed
-> 402 {error:"subscription_required"}; a daily abuse ceiling still applies
(cost protection on the Bedrock spend, not a marketed limit) -> 429
{error:"rate_limited", resetsAt}. /api/me itself is not gated — it's how
the extension checks subscription status in the first place.

Stdlib + boto3 only: no third-party deps, so `cdk synth`/deploy work from
any host for an ARM_64 runtime — no Docker bundling step.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
bedrock = boto3.client("bedrock-runtime")
TABLE_NAME = os.environ["SNAG_TABLE"]
TABLE = dynamodb.Table(TABLE_NAME)

# Abuse ceiling on Bedrock spend (this is the only metered call now that
# generation is BYOK) — well above realistic single-user usage.
EMBED_CAP_PER_DAY = 500

# Free-access allowlist (dev/owner accounts) — bypasses the subscription
# gate entirely, on both /api/me (so the sidebar shows Pro status) and
# /api/embed (so the gate itself doesn't block it). Case-insensitive.
FREE_EMAILS = {"chandrasailesh30@gmail.com"}

BEDROCK_EMBED_MODEL = "amazon.titan-embed-text-v2:0"


# --- DynamoDB helpers ------------------------------------------------------

def _get_item(pk, sk):
    resp = TABLE.get_item(Key={"pk": pk, "sk": sk})
    return resp.get("Item") or {}


def _subscription(sub):
    return _get_item(f"USER#{sub}", "SUBSCRIPTION")


def _is_free_account(email):
    return bool(email) and email.lower() in FREE_EMAILS


def _require_subscription(sub, email=""):
    """200-OK gate, or the 402 response."""
    if not sub:
        return _json(401, {"error": "unauthorized"})
    if _is_free_account(email):
        return None
    if _subscription(sub).get("status") != "active":
        return _json(402, {"error": "subscription_required"})
    return None


def _bump_usage(sub, kind):
    """Atomically increment the daily+monthly usage counters.

    Returns None on success, or the 429 response when the daily ceiling is
    reached. The counter item is `USAGE#<YYYY-MM>` (plan A2): new month =
    new item, no reset job. The daily window lives in two attributes
    (`<kind>Day` / `<kind>DayCount`) and is re-baselined lazily on first
    use of the new day.

    Atomicity: conditional updates only. A same-day increment
    (`IF <kind>Day = today`) falls back to a re-baseline
    (`IF day missing OR day <> today`); a lost race at the day boundary
    undercounts the day counter by one — acceptable for an abuse ceiling
    that is not billing.
    """
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    key = {"pk": f"USER#{sub}", "sk": f"USAGE#{now.strftime('%Y-%m')}"}
    cap = EMBED_CAP_PER_DAY
    values = {"today": today, "one": 1}

    same_day = (
        f"SET {kind}Count = {kind}Count + :one, "
        f"{kind}DayCount = if_not_exists({kind}DayCount, :one) + :one",
        f"{kind}Day = :today",
    )
    new_day = (
        f"SET {kind}Day = :today, {kind}DayCount = :one, {kind}Count = {kind}Count + :one",
        f"attribute_not_exists({kind}Day) OR {kind}Day <> :today",
    )

    try:
        resp = _update_if(key, same_day[0], same_day[1], values)
    except _ConditionFailed:
        try:
            resp = _update_if(key, new_day[0], new_day[1], values)
        except _ConditionFailed:
            # Someone re-baselined between our attempts; one same-day retry.
            resp = _update_if(key, same_day[0], same_day[1], values)

    day_count = resp.get("Attributes", {}).get(f"{kind}DayCount", 1)
    if day_count > cap:
        resets_at = (now + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
        return _json(429, {"error": "rate_limited", "resetsAt": resets_at})
    return None


class _ConditionFailed(Exception):
    pass


def _update_if(key, update_expr, condition, values):
    try:
        return TABLE.update_item(
            Key=key,
            UpdateExpression=update_expr,
            ConditionExpression=condition,
            ExpressionAttributeValues=values,
            ReturnValues="UPDATED_NEW",
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        raise _ConditionFailed() from None


# --- Bedrock (IAM-only, no provider key/secret at all) ---------------------

def _titan_embed(text):
    """Returns (vector, None) or (None, (status, error_message))."""
    try:
        resp = bedrock.invoke_model(
            modelId=BEDROCK_EMBED_MODEL,
            body=json.dumps({"inputText": text[:8000]}),
            contentType="application/json",
            accept="application/json",
        )
        result = json.loads(resp["body"].read())
        return result["embedding"], None
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        message = e.response.get("Error", {}).get("Message", str(e))
        return None, (502, f"bedrock error {code}: {message}")
    except Exception as e:
        return None, (502, f"bedrock error: {e}")


# --- routes ------------------------------------------------------------------

def handler(event, context):
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", "")
    path = http.get("path", "")
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    sub = claims.get("sub", "")
    email = claims.get("email", "")
    body = json.loads(event.get("body") or "{}") if event.get("body") else {}

    if method == "GET" and path == "/api/me":
        return get_me(sub, email)
    if method == "POST" and path == "/api/embed":
        return embed(sub, email, body)
    return _json(404, {"error": "not_found", "path": path})


def get_me(sub, email=""):
    if not sub:
        return _json(401, {"error": "unauthorized"})
    if _is_free_account(email):
        return _json(200, {"sub": sub, "email": email, "subscriptionStatus": "active", "currentPeriodEnd": None})
    item = _subscription(sub)
    return _json(200, {
        "sub": sub,
        "email": email,
        "subscriptionStatus": item.get("status", "none"),
        "currentPeriodEnd": item.get("currentPeriodEnd"),
    })


def embed(sub, email, body):
    denied = _require_subscription(sub, email)
    if denied:
        return denied

    text = body.get("text") or ""
    if not text.strip():
        return _json(400, {"error": "missing_text"})

    limited = _bump_usage(sub, "embed")
    if limited:
        return limited

    vector, error = _titan_embed(text)
    if error:
        status, message = error
        return _json(status, {"error": message})
    return _json(200, {"embedding": vector})


# --- response helpers ----------------------------------------------------------

def _json(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
