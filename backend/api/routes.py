from fastapi import APIRouter

from backend.config import settings

router = APIRouter(prefix="/api")


@router.get("/health")
async def health():
    from backend.orchestrator import orchestrator
    llm_ready = orchestrator.llm_agent is not None
    return {
        "status": "ok" if llm_ready else "degraded",
        "app": settings.app_name,
        "version": settings.app_version,
        "ollama_model": settings.ollama_model,
    }
