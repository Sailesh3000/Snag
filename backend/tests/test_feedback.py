"""Sidebar feedback -> emailed to the maintainer over SMTP.

smtplib.SMTP_SSL is monkeypatched to a fake client so tests never touch a
real network/mailbox, while still exercising the real send_feedback_email()
logic (subject/body construction, config-missing/failure error paths).
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.feedback_routes import router as feedback_router
from backend.config import settings
from backend.tests.conftest import AUTH_HEADERS


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(feedback_router)
    return TestClient(app, headers=AUTH_HEADERS)


class FakeSMTP:
    sent_messages: list = []

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def login(self, username, password):
        self.username = username
        self.password = password

    def send_message(self, msg):
        FakeSMTP.sent_messages.append(msg)


@pytest.fixture(autouse=True)
def _configure_smtp(monkeypatch):
    monkeypatch.setattr(settings, "smtp_username", "sender@example.com")
    monkeypatch.setattr(settings, "smtp_password", "app-password")
    monkeypatch.setattr(settings, "feedback_to_email", "chandrasailesh30@gmail.com")
    FakeSMTP.sent_messages = []
    import smtplib
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    yield


def test_feedback_requires_auth():
    app = FastAPI()
    app.include_router(feedback_router)
    client = TestClient(app)  # no auth headers
    resp = client.post("/api/feedback", json={"type": "bug", "message": "It broke"})
    assert resp.status_code == 401


def test_feedback_rejects_empty_message():
    resp = make_client().post("/api/feedback", json={"type": "bug", "message": "   "})
    assert resp.status_code == 400


def test_feedback_sends_email_with_expected_fields():
    resp = make_client().post("/api/feedback", json={
        "type": "bug",
        "message": "The fill button does nothing",
        "email": "reporter@example.com",
        "source": "extension",
        "version": "0.2.0",
    })
    assert resp.status_code == 200
    assert resp.json() == {"sent": True}

    assert len(FakeSMTP.sent_messages) == 1
    msg = FakeSMTP.sent_messages[0]
    assert msg["To"] == "chandrasailesh30@gmail.com"
    assert msg["From"] == "sender@example.com"
    assert "bug" in msg["Subject"]
    assert msg["Reply-To"] == "reporter@example.com"
    assert "The fill button does nothing" in msg.get_content()


def test_feedback_without_reporter_email_still_sends():
    resp = make_client().post("/api/feedback", json={"type": "general", "message": "Nice tool"})
    assert resp.status_code == 200
    msg = FakeSMTP.sent_messages[0]
    assert msg["Reply-To"] is None


def test_unknown_feedback_type_falls_back_to_general():
    resp = make_client().post("/api/feedback", json={"type": "nonsense", "message": "hi"})
    assert resp.status_code == 200
    assert "general" in FakeSMTP.sent_messages[0]["Subject"]


def test_feedback_returns_503_when_smtp_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "smtp_username", "")
    monkeypatch.setattr(settings, "smtp_password", "")
    resp = make_client().post("/api/feedback", json={"type": "bug", "message": "test"})
    assert resp.status_code == 503


def test_feedback_returns_502_on_smtp_failure(monkeypatch):
    import smtplib

    class FailingSMTP(FakeSMTP):
        def login(self, username, password):
            raise smtplib.SMTPAuthenticationError(535, b"bad credentials")

    monkeypatch.setattr(smtplib, "SMTP_SSL", FailingSMTP)
    resp = make_client().post("/api/feedback", json={"type": "bug", "message": "test"})
    assert resp.status_code == 502
