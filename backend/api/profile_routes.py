from fastapi import APIRouter, Depends, HTTPException, UploadFile

from backend.auth import require_auth
from backend.memory.sqlite_store import sqlite_store
from backend.resume_parser import ResumeParseError, extract_text

router = APIRouter(prefix="/api/profile", dependencies=[Depends(require_auth)])

PROFILE_FIELDS = [
    "first_name", "last_name", "name", "email", "phone",
    "gender", "date_of_birth",
    "address", "city", "state", "zip_code", "country",
    "linkedin", "github", "portfolio",
    "education", "experience", "skills",
    "work_authorization", "visa_status", "willing_to_relocate",
]


@router.get("")
async def get_profile():
    return sqlite_store.get_profile()


@router.get("/all")
async def get_all_fields():
    return sqlite_store.get_all_fields()


@router.put("/{key}")
async def update_profile(key: str, value: str):
    if key not in PROFILE_FIELDS:
        raise HTTPException(400, f"Invalid field: {key}. Valid: {', '.join(PROFILE_FIELDS)}")
    sqlite_store.set_profile(key, value)
    return {"key": key, "value": value}


@router.delete("/{key}")
async def delete_profile(key: str):
    sqlite_store.delete_profile(key)
    return {"deleted": key}


@router.post("/resume/upload")
async def upload_resume(file: UploadFile):
    import uuid
    from pathlib import Path

    import aiofiles

    from backend.config import settings

    upload_dir = Path(settings.resume_upload_dir).resolve()
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Never trust the client-supplied filename for the on-disk path — take
    # only its extension (sanitized) and generate the actual filename.
    original_name = Path(file.filename or "resume").name or "resume"
    suffix = "".join(c for c in Path(original_name).suffix if c.isalnum() or c == ".")[:10]
    dest = (upload_dir / f"{uuid.uuid4().hex}{suffix}").resolve()

    if upload_dir not in dest.parents:
        raise HTTPException(400, "Invalid filename")

    async with aiofiles.open(str(dest), "wb") as f:
        content = await file.read()
        await f.write(content)

    resume_id = sqlite_store.add_resume(original_name, str(dest))

    resume_text: str | None = None
    extraction_error: str | None = None
    try:
        resume_text = extract_text(original_name, content)
    except ResumeParseError as e:
        extraction_error = str(e)

    return {
        "id": resume_id,
        "name": original_name,
        "path": str(dest),
        "resumeText": resume_text,
        "extractionError": extraction_error,
    }


@router.get("/resumes")
async def list_resumes():
    return sqlite_store.get_resumes()


@router.delete("/resume/{resume_id}")
async def delete_resume(resume_id: int):
    sqlite_store.delete_resume(resume_id)
    return {"deleted": resume_id}
