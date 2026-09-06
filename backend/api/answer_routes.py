import logging

from fastapi import APIRouter, Depends, HTTPException

from backend.answer_service import prepare_context
from backend.auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/answer", dependencies=[Depends(require_auth)])


@router.post("/prepare")
async def prepare(body: dict):
    result = await prepare_context(
        question=body.get("question", ""),
        company=body.get("company", ""),
        role=body.get("role", ""),
        job_description=body.get("jobDescription", ""),
        session_id=body.get("sessionId", ""),
    )
    return result
