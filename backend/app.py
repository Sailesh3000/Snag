import logging
import logging.handlers
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.answer_routes import router as answer_router
from backend.api.memory_routes import router as memory_router
from backend.api.profile_routes import router as profile_router
from backend.api.routes import router
from backend.api.ws import ws_router
from backend.config import settings

LOG_DIR = Path(__file__).parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)


def setup_logging():
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    fh = logging.handlers.RotatingFileHandler(
        LOG_DIR / "snag.log", maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    fh.setLevel(logging.INFO)
    fh.setFormatter(fmt)
    root.addHandler(fh)

    ch = logging.StreamHandler()
    ch.setLevel(logging.WARNING)
    ch.setFormatter(fmt)
    root.addHandler(ch)


setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from backend.memory.sqlite_store import sqlite_store
    sqlite_store.connect()
    logger.info("SQLite connected")

    from backend.memory.embeddings import get_model
    get_model()
    logger.info("Embedding model loaded")

    logger.info(f"{settings.app_name} v{settings.app_version} starting")
    logger.info(f"Ollama URL: {settings.ollama_url}")
    logger.warning("=" * 64)
    logger.warning("Snag auth token (paste into the extension's Settings page):")
    logger.warning(f"  {settings.auth_token}")
    logger.warning(f"Also saved to: {settings.auth_token_path}")
    logger.warning("=" * 64)
    try:
        yield
    finally:
        sqlite_store.close()
        logger.info("shutdown complete")


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

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


if __name__ == "__main__":
    uvicorn.run(
        "backend.app:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level=settings.log_level.lower(),
    )
