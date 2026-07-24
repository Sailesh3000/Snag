from fastapi import APIRouter, HTTPException, UploadFile

from backend.memory.sqlite_store import sqlite_store

router = APIRouter(prefix="/api/profile")

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
    import aiofiles
    from pathlib import Path

    upload_dir = Path("data/resumes")
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / file.filename

    async with aiofiles.open(str(dest), "wb") as f:
        content = await file.read()
        await f.write(content)

    resume_id = sqlite_store.add_resume(file.filename, str(dest))
    return {"id": resume_id, "name": file.filename, "path": str(dest)}


@router.get("/resumes")
async def list_resumes():
    return sqlite_store.get_resumes()


@router.delete("/resume/{resume_id}")
async def delete_resume(resume_id: int):
    sqlite_store.delete_resume(resume_id)
    return {"deleted": resume_id}
