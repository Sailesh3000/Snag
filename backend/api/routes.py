from fastapi import APIRouter

from backend.config import settings

router = APIRouter(prefix="/api")


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
    }
