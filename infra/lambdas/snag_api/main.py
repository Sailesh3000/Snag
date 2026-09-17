"""Snag API — free, no billing: identity check + Bedrock-backed embeddings.

LLM *generation* is BYOK — the extension calls Anthropic/OpenAI directly
with the user's own key (extension/src/llm/client.ts), so this backend
never spends money on tokens and holds no LLM provider key at all. There is
no subscription or paid tier: every signed-in user gets full access. The
one thing still centralized here is semantic "similar past answers"
memory matching, via Amazon Bedrock Titan Embeddings, which is IAM-only
(no external API key, no per-user secret).

Routes (the API Gateway Cognito JWT authorizer validates the access token
before anything reaches this Lambda; verified claims arrive in
event["requestContext"]["authorizer"]["jwt"]["claims"] — HTTP API's JWT
authorizer nests them under "jwt", unlike a REST API/v1 custom authorizer's
flatter shape — and `sub` is the only per-user key the backend ever needs):

  GET  /api/me      -> {sub, email} — confirms the token is valid
  POST /api/embed    -> {"embedding": [...]} (Bedrock Titan Text Embeddings v2)

Gating: /api/embed requires a signed-in `sub` (401 otherwise) and is
subject to a daily abuse ceiling (429, cost protection on the Bedrock
spend only — not a marketed limit, there is nothing to subscribe to).

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

# Abuse ceiling on Bedrock spend (this is the only metered call) — well
# above realistic single-user usage.
EMBED_CAP_PER_DAY = 500

BEDROCK_EMBED_MODEL = "amazon.titan-embed-text-v2:0"


# --- DynamoDB helpers ------------------------------------------------------

def _bump_usage(sub, kind):
    """Atomically increment the daily+monthly usage counters.

    Returns None on success, or the 429 response when the daily ceiling is
    reached. The counter item is `USAGE#<YYYY-MM>`: new month = new item,
    no reset job. The daily window lives in two attributes
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
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    sub = claims.get("sub", "")
    email = claims.get("email", "")
    body = json.loads(event.get("body") or "{}") if event.get("body") else {}

    if method == "GET" and path == "/api/me":
        return get_me(sub, email)
    if method == "POST" and path == "/api/embed":
        return embed(sub, body)
    return _json(404, {"error": "not_found", "path": path})


def get_me(sub, email=""):
    if not sub:
        return _json(401, {"error": "unauthorized"})
    return _json(200, {"sub": sub, "email": email})


def embed(sub, body):
    if not sub:
        return _json(401, {"error": "unauthorized"})

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
