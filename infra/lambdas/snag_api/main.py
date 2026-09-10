"""Snag API — Phase 2: stateless, subscription-gated LLM proxy.

Routes (the API Gateway Cognito JWT authorizer validates the access token
before anything reaches this Lambda; verified claims arrive in
event["requestContext"]["authorizer"]["claims"], and `sub` is the only
per-user key the backend ever needs):

  GET  /api/me               -> {sub, email, subscriptionStatus, currentPeriodEnd}
  POST /api/answer/generate  -> SSE stream of {"text": "..."} events + [DONE]
  POST /api/embed            -> {"embedding": [...]} (OpenAI text-embedding-3-small)

Gating (plan A4), applied to both paying endpoints:
  1. No `status == "active"` SUBSCRIPTION item  -> 402 {error:"subscription_required"}
  2. Daily abuse ceiling (well above real usage; cost protection, not a
     marketed limit)                              -> 429 {error:"rate_limited", resetsAt}

Why a plain handler instead of FastAPI+Mangum (revising the Phase 1 note):
Mangum's ASGI adapter does not stream responses in the classic Lambda path
(it buffers the full body), so it would have added three dependencies and
asset-bundling risk for zero streaming benefit. The SSE *contract* is
unchanged: the body is a valid text/event-stream, and the extension client
parses it identically. Incremental (token-by-token) delivery is a Lambda +
API Gateway *response-streaming* runtime feature to enable and verify at
deploy time; it does not change this handler's request/response contract.

Stdlib-only on purpose (urllib for provider calls): the Lambda zip bundles
zero third-party dependencies, so `cdk synth`/deploy work from any host
(Windows included) for an ARM_64 runtime — no Docker bundling step.
"""
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
ssm = boto3.client("ssm")
TABLE_NAME = os.environ["SNAG_TABLE"]
TABLE = dynamodb.Table(TABLE_NAME)

# Abuse ceilings (plan A4: "a high daily number ... well above realistic
# single-user usage"). Adjust by changing constants and redeploying.
GENERATE_CAP_PER_DAY = 300
EMBED_CAP_PER_DAY = 500

ANTHROPIC_MODEL = "claude-sonnet-4-5"
OPENAI_EMBED_MODEL = "text-embedding-3-small"
PROVIDER_TIMEOUT_S = 55


# --- secrets (SSM, read at runtime — never in the function environment) ---

def _secret(name):
    try:
        resp = ssm.get_parameter(Name=f"/snag/{name}", WithDecryption=True)
        value = resp.get("Parameter", {}).get("Value", "")
        return "" if value == "REPLACE_ME_OUT_OF_BAND" else value
    except Exception:
        return ""


# --- DynamoDB helpers ------------------------------------------------------

def _get_item(pk, sk):
    resp = TABLE.get_item(Key={"pk": pk, "sk": sk})
    return resp.get("Item") or {}


def _subscription(sub):
    return _get_item(f"USER#{sub}", "SUBSCRIPTION")


def _require_subscription(sub):
    """200-OK gate, or the 402 response."""
    if not sub:
        return _json(401, {"error": "unauthorized"})
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
    cap = GENERATE_CAP_PER_DAY if kind == "generate" else EMBED_CAP_PER_DAY
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


# --- provider calls (stdlib only) ------------------------------------------

def _http_json(url, payload, headers, timeout=PROVIDER_TIMEOUT_S):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _anthropic_stream(api_key, system, prompt):
    """Returns (chunks, None) or (None, (status, error_message))."""
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1024,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    chunks = []
    try:
        with urllib.request.urlopen(req, timeout=PROVIDER_TIMEOUT_S) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                try:
                    evt = json.loads(data)
                except ValueError:
                    continue
                if evt.get("type") == "content_block_delta":
                    text = evt.get("delta", {}).get("text", "")
                    if text:
                        chunks.append(text)
                elif evt.get("type") == "error":
                    return None, (502, evt.get("error", {}).get("message", "provider error"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8", "replace")).get("error", {}).get("message", "")
        except Exception:
            pass
        return None, (502, f"provider error {e.code} {detail}".strip())
    except Exception as e:  # timeout, TLS, network
        return None, (502, f"provider error: {e}")
    return chunks, None


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
    if method == "POST" and path == "/api/answer/generate":
        return generate(sub, body)
    if method == "POST" and path == "/api/embed":
        return embed(sub, body)
    return _json(404, {"error": "not_found", "path": path})


def get_me(sub, email=""):
    if not sub:
        return _json(401, {"error": "unauthorized"})
    item = _subscription(sub)
    return _json(200, {
        "sub": sub,
        "email": email,
        "subscriptionStatus": item.get("status", "none"),
        "currentPeriodEnd": item.get("currentPeriodEnd"),
    })


def generate(sub, body):
    denied = _require_subscription(sub)
    if denied:
        return denied

    prompt = body.get("prompt") or ""
    if not prompt.strip():
        return _json(400, {"error": "missing_prompt"})

    limited = _bump_usage(sub, "generate")
    if limited:
        return limited

    api_key = _secret("anthropic_api_key")
    if not api_key:
        return _json(503, {"error": "provider_not_configured"})

    chunks, error = _anthropic_stream(api_key, body.get("systemPrompt") or "", prompt)
    if error:
        status, message = error
        return _json(status, {"error": message})

    sse = "".join(f"data: {json.dumps({'text': c})}\n\n" for c in chunks)
    sse += "data: [DONE]\n\n"
    return _sse(sse)


def embed(sub, body):
    denied = _require_subscription(sub)
    if denied:
        return denied

    text = body.get("text") or ""
    if not text.strip():
        return _json(400, {"error": "missing_text"})

    limited = _bump_usage(sub, "embed")
    if limited:
        return limited

    api_key = _secret("openai_api_key")
    if not api_key:
        return _json(503, {"error": "provider_not_configured"})

    try:
        result = _http_json(
            "https://api.openai.com/v1/embeddings",
            {"model": OPENAI_EMBED_MODEL, "input": text[:8000]},
            {"Authorization": f"Bearer {api_key}"},
        )
        vector = result["data"][0]["embedding"]
    except urllib.error.HTTPError as e:
        return _json(502, {"error": f"provider error {e.code}"})
    except Exception as e:
        return _json(502, {"error": f"provider error: {e}"})
    return _json(200, {"embedding": vector})


# --- response helpers ----------------------------------------------------------

def _json(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _sse(body):
    # X-Accel-Buffering/Cache-Control keep intermediate proxies from holding
    # the stream; with Lambda response streaming enabled these make the
    # events flow incrementally.
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
        "body": body,
    }
