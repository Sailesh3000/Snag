"""Per-installation token auth.

Snag has no user accounts and binds to 127.0.0.1 by default, but loopback
binding alone does not stop other pages/processes running on the SAME
machine (e.g. any other browser tab) from reaching this server — the
browser itself lives on that loopback interface. This token is the actual
access-control boundary: it's generated once per install (backend/config.py),
never sent to arbitrary web pages, and must be presented on every
profile/memory/answer request.
"""
import secrets

from fastapi import Header, HTTPException, WebSocket

from backend.config import settings


def verify_token(candidate: str | None) -> bool:
    if not candidate or not settings.auth_token:
        return False
    return secrets.compare_digest(candidate, settings.auth_token)


async def require_auth(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency: reject the request unless it carries a valid
    `Authorization: Bearer <token>` header."""
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[len("bearer "):]
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Missing or invalid auth token")


async def require_ws_auth(websocket: WebSocket) -> bool:
    """Check a WebSocket connection's `?token=` query param.

    Must be called (and the connection closed on failure) BEFORE
    `websocket.accept()` — an unauthenticated client should never reach an
    accepted, live connection.
    """
    return verify_token(websocket.query_params.get("token"))
