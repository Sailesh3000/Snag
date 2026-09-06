"""Accept must not be reported/saved as successful until the content script
actually confirms the DOM write worked (P1 item #4)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.ws import ws_router
from backend.memory.sqlite_store import sqlite_store
from backend.tests.conftest import AUTH_TOKEN


def connect():
    app = FastAPI()
    app.include_router(ws_router)
    client = TestClient(app)
    ws = client.websocket_connect(f"/ws/ses_fill_test?token={AUTH_TOKEN}")
    conn = ws.__enter__()
    conn.receive_json()  # initial status:update
    return ws, conn


def test_fill_approve_does_not_save_before_confirmation():
    ws, conn = connect()
    try:
        conn.send_json({
            "type": "fill:approve",
            "payload": {"requestId": "req1", "question": "Why this role", "value": "Because I love it.",
                        "company": "Acme", "role": "Engineer", "selector": "#q1", "fieldId": "f1"},
        })
        instruct = conn.receive_json()
        assert instruct["type"] == "fill:instruct"
        assert instruct["payload"]["requestId"] == "req1"

        # No fill:result yet -> must not be saved.
        row = sqlite_store._conn.execute(
            "SELECT id FROM answers WHERE question = ?", ("Why this role",)
        ).fetchone()
        assert row is None
    finally:
        ws.__exit__(None, None, None)


def test_fill_result_success_saves_and_reports_success():
    ws, conn = connect()
    try:
        conn.send_json({
            "type": "fill:approve",
            "payload": {"requestId": "req2", "question": "Why this role", "value": "Because I love it.",
                        "company": "Acme", "role": "Engineer", "selector": "#q1", "fieldId": "f1"},
        })
        conn.receive_json()  # fill:instruct

        conn.send_json({
            "type": "fill:result",
            "payload": {"requestId": "req2", "fieldId": "f1", "success": True},
        })
        result = conn.receive_json()
        assert result["type"] == "fill:executed"
        assert result["payload"]["success"] is True

        row = sqlite_store._conn.execute(
            "SELECT final_answer FROM answers WHERE question = ?", ("Why this role",)
        ).fetchone()
        assert row is not None
        assert row["final_answer"] == "Because I love it."
    finally:
        ws.__exit__(None, None, None)


def test_fill_result_failure_does_not_save_and_reports_failure():
    ws, conn = connect()
    try:
        conn.send_json({
            "type": "fill:approve",
            "payload": {"requestId": "req3", "question": "Stale selector question", "value": "Some answer.",
                        "company": "Acme", "role": "Engineer", "selector": "#gone", "fieldId": "f2"},
        })
        conn.receive_json()  # fill:instruct

        conn.send_json({
            "type": "fill:result",
            "payload": {"requestId": "req3", "fieldId": "f2", "success": False, "reason": "stale_selector"},
        })
        result = conn.receive_json()
        assert result["type"] == "fill:executed"
        assert result["payload"]["success"] is False
        assert result["payload"]["reason"] == "stale_selector"

        row = sqlite_store._conn.execute(
            "SELECT id FROM answers WHERE question = ?", ("Stale selector question",)
        ).fetchone()
        assert row is None
    finally:
        ws.__exit__(None, None, None)


def test_fill_reject_never_saves():
    before = sqlite_store._conn.execute("SELECT COUNT(*) as c FROM answers").fetchone()["c"]

    ws, conn = connect()
    try:
        conn.send_json({
            "type": "fill:reject",
            "payload": {"fieldId": "f3"},
        })
        result = conn.receive_json()
        assert result["type"] == "fill:rejected"
    finally:
        ws.__exit__(None, None, None)

    after = sqlite_store._conn.execute("SELECT COUNT(*) as c FROM answers").fetchone()["c"]
    assert after == before
