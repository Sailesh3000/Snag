"""P0 security: REST + WebSocket must reject unauthenticated/mistoken requests.

Snag binds to 127.0.0.1 by default, but that alone doesn't stop another page
open in the same browser from reaching it — the per-installation auth token
(backend/auth.py, backend/config.py) is the real access-control boundary.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.api.profile_routes import router as profile_router
from backend.api.ws import ws_router
from backend.memory.sqlite_store import sqlite_store
from backend.tests.conftest import AUTH_HEADERS, AUTH_TOKEN


def make_rest_client() -> TestClient:
    app = FastAPI()
    app.include_router(profile_router)
    return TestClient(app)  # no default auth headers here — tests set them explicitly


def make_ws_client() -> TestClient:
    app = FastAPI()
    app.include_router(ws_router)
    return TestClient(app)


def test_unauthenticated_rest_request_is_rejected():
    client = make_rest_client()
    resp = client.get("/api/profile")
    assert resp.status_code == 401


def test_rest_request_with_wrong_token_is_rejected():
    client = make_rest_client()
    resp = client.get("/api/profile", headers={"Authorization": "Bearer not-the-real-token"})
    assert resp.status_code == 401


def test_authenticated_rest_request_is_accepted():
    client = make_rest_client()
    resp = client.get("/api/profile", headers=AUTH_HEADERS)
    assert resp.status_code == 200


def test_arbitrary_webpage_cannot_read_profile_data_without_the_token():
    """Simulates the real threat: some other page open in the browser
    fetching the local backend directly, with no token to present."""
    sqlite_store.set_profile("email", "victim@example.com")
    client = make_rest_client()

    resp = client.get("/api/profile")

    assert resp.status_code == 401
    assert "victim@example.com" not in resp.text


def test_unauthenticated_websocket_is_rejected():
    client = make_ws_client()
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws/ses_test_noauth"):
            pass
    assert exc_info.value.code == 4401


def test_websocket_with_wrong_token_is_rejected():
    client = make_ws_client()
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws/ses_test_badtoken?token=wrong"):
            pass
    assert exc_info.value.code == 4401


def test_authenticated_websocket_is_accepted():
    client = make_ws_client()
    with client.websocket_connect(f"/ws/ses_test_ok?token={AUTH_TOKEN}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "status:update"
        assert msg["payload"]["connected"] is True
