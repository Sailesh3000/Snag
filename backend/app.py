import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.answer_routes import router as answer_router
from backend.api.memory_routes import router as memory_router
from backend.api.profile_routes import router as profile_router
from backend.api.routes import router
from backend.api.ws import ws_router
from backend.config import settings

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name, version=settings.app_version)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(profile_router)
app.include_router(memory_router)
app.include_router(answer_router)
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": settings.app_version}


@app.on_event("startup")
async def startup():
    from backend.memory.sqlite_store import sqlite_store
    sqlite_store.connect()
    logger.info("SQLite connected")

    from backend.memory.embeddings import get_model
    get_model()
    logger.info("Embedding model loaded")

    logger.info(f"{settings.app_name} v{settings.app_version} starting")
    logger.info(f"Ollama URL: {settings.ollama_url}")


@app.on_event("shutdown")
async def shutdown():
    from backend.memory.sqlite_store import sqlite_store
    sqlite_store.close()
    logger.info("shutdown complete")


if __name__ == "__main__":
    uvicorn.run(
        "backend.app:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level=settings.log_level.lower(),
    )
