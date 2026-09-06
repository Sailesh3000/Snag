"""P0 security: resume upload must never write outside the resume directory,
no matter what filename the client claims."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.profile_routes import router as profile_router
from backend.config import settings
from backend.memory.sqlite_store import sqlite_store
from backend.tests.conftest import AUTH_HEADERS


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(profile_router)
    return TestClient(app, headers=AUTH_HEADERS)


MALICIOUS_FILENAMES = [
    "../evil.txt",
    "../../evil.txt",
    "../../../etc/evil.txt",
    "..\\..\\evil.txt",
    "/etc/evil.txt",
    "C:\\Windows\\evil.txt",
]


def test_resume_upload_rejects_path_traversal_filenames():
    upload_dir = Path(settings.resume_upload_dir).resolve()

    for filename in MALICIOUS_FILENAMES:
        client = make_client()
        resp = client.post(
            "/api/profile/resume/upload",
            files={"file": (filename, b"not a real resume", "application/octet-stream")},
        )
        assert resp.status_code == 200, f"filename={filename!r}"
        body = resp.json()
        dest = Path(body["path"]).resolve()

        assert upload_dir in dest.parents, f"escaped upload dir for filename={filename!r}: {dest}"
        assert dest.exists()


def test_resume_upload_generates_random_storage_filename_not_client_supplied():
    client = make_client()
    resp = client.post(
        "/api/profile/resume/upload",
        files={"file": ("my_resume.pdf", b"pdf bytes", "application/pdf")},
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["name"] == "my_resume.pdf"  # display name preserved
    assert Path(body["path"]).name != "my_resume.pdf"  # on-disk name is not client-controlled
    assert Path(body["path"]).suffix == ".pdf"


def test_uploaded_resume_is_listed():
    client = make_client()
    client.post(
        "/api/profile/resume/upload",
        files={"file": ("resume.pdf", b"pdf bytes", "application/pdf")},
    )
    resp = client.get("/api/profile/resumes")
    assert resp.status_code == 200
    names = [r["name"] for r in resp.json()]
    assert "resume.pdf" in names


def test_upload_returns_extracted_text_for_a_plain_text_resume():
    client = make_client()
    resp = client.post(
        "/api/profile/resume/upload",
        files={"file": ("resume.txt", b"Ada Lovelace\nSoftware Engineer", "text/plain")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["extractionError"] is None
    assert "Ada Lovelace" in body["resumeText"]


def test_upload_reports_extraction_error_for_unsupported_type_without_failing_the_upload():
    client = make_client()
    resp = client.post(
        "/api/profile/resume/upload",
        files={"file": ("resume.docx", b"whatever bytes", "application/vnd.openxmlformats")},
    )
    assert resp.status_code == 200  # the file is still saved
    body = resp.json()
    assert body["resumeText"] is None
    assert body["extractionError"]
