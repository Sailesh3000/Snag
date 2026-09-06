"""Profile creation/update/retrieval (Step 1 of the target UX)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.profile_routes import router as profile_router
from backend.memory.sqlite_store import sqlite_store


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(profile_router)
    return TestClient(app)


def test_profile_starts_empty():
    client = make_client()
    resp = client.get("/api/profile")
    assert resp.status_code == 200
    assert resp.json() == {}


def test_set_and_get_profile_field():
    client = make_client()
    resp = client.put("/api/profile/first_name", params={"value": "Ada"})
    assert resp.status_code == 200
    assert resp.json() == {"key": "first_name", "value": "Ada"}

    resp = client.get("/api/profile")
    assert resp.json()["first_name"] == "Ada"


def test_update_existing_field_overwrites():
    client = make_client()
    client.put("/api/profile/skills", params={"value": "Python"})
    client.put("/api/profile/skills", params={"value": "Python, SQL"})
    resp = client.get("/api/profile")
    assert resp.json()["skills"] == "Python, SQL"


def test_invalid_field_key_rejected():
    client = make_client()
    resp = client.put("/api/profile/not_a_real_field", params={"value": "x"})
    assert resp.status_code == 400


def test_delete_profile_field():
    client = make_client()
    client.put("/api/profile/city", params={"value": "Bengaluru"})
    resp = client.delete("/api/profile/city")
    assert resp.status_code == 200
    assert "city" not in client.get("/api/profile").json()


def test_get_all_fields_includes_unverified_metadata():
    sqlite_store.set_profile("email", "ada@example.com")
    resp = make_client().get("/api/profile/all")
    keys = {row["key"] for row in resp.json()}
    assert "email" in keys
