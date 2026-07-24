import logging
from functools import lru_cache

from sentence_transformers import SentenceTransformer

from backend.config import settings

logger = logging.getLogger(__name__)

_model = None


def get_model():
    global _model
    if _model is None:
        logger.info(f"Loading sentence-transformers model: {settings.embedding_model}")
        _model = SentenceTransformer(settings.embedding_model)
    return _model


async def generate_embedding(text: str) -> list[float]:
    try:
        emb = get_model().encode(text, normalize_embeddings=True)
        return emb.tolist()
    except Exception as e:
        logger.warning(f"Embedding generation failed: {e}")
        return []


async def generate_embedding_batch(texts: list[str]) -> list[list[float]]:
    try:
        embs = get_model().encode(texts, normalize_embeddings=True)
        return [e.tolist() for e in embs]
    except Exception as e:
        logger.warning(f"Batch embedding failed: {e}")
        return []
