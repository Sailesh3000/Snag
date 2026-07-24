import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend.answer_service import generate_answer, generate_answer_stream

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/answer")


@router.post("/generate")
async def generate(request: Request, body: dict):
    provider = request.headers.get("X-Provider", "ollama")
    api_key = request.headers.get("X-API-Key", "")
    model = request.headers.get("X-Model", "")
    base_url = request.headers.get("X-Base-URL", "")

    result = await generate_answer(
        question=body.get("question", ""),
        company=body.get("company", ""),
        role=body.get("role", ""),
        job_description=body.get("jobDescription", ""),
        session_id=body.get("sessionId", ""),
        provider=provider,
        api_key=api_key,
        model=model,
        base_url=base_url,
    )
    if result.get("error"):
        raise HTTPException(status_code=502, detail=result["error"])
    return result


@router.post("/generate/stream")
async def generate_stream(request: Request, body: dict):
    provider = request.headers.get("X-Provider", "ollama")
    api_key = request.headers.get("X-API-Key", "")
    model = request.headers.get("X-Model", "")
    base_url = request.headers.get("X-Base-URL", "")

    return StreamingResponse(
        generate_answer_stream(
            question=body.get("question", ""),
            company=body.get("company", ""),
            role=body.get("role", ""),
            job_description=body.get("jobDescription", ""),
            provider=provider,
            api_key=api_key,
            model=model,
            base_url=base_url,
        ),
        media_type="application/x-ndjson",
    )
