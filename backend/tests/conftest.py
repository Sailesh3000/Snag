"""Shared test fixtures.

Every test runs against an isolated temp SQLite file (never the real
data/snag.db) and a deterministic bag-of-words stand-in for the real
sentence-transformers embedding model, so the suite is fast and doesn't
require downloading/loading model weights. The fake embedding is only a
token-overlap vector — good enough to prove the retrieval *pipeline*
(cosine similarity, ranking, cross-company matching, dedup) behaves
correctly; real semantic quality comes from the production model.
"""
import hashlib
import os
import re
import tempfile
from pathlib import Path

import numpy as np
import pytest

_TMP_DIR = tempfile.mkdtemp(prefix="snag_test_")
os.environ.setdefault("SNAG_SQLITE_PATH", str(Path(_TMP_DIR) / "test_snag.db"))
os.environ.setdefault("SNAG_RESUME_UPLOAD_DIR", str(Path(_TMP_DIR) / "resumes"))
os.environ.setdefault("SNAG_AUTH_TOKEN", "test-fixed-token-for-pytest")

from backend.memory import memory_service  # noqa: E402
from backend.memory.sqlite_store import sqlite_store  # noqa: E402

EMBED_DIM = 64
AUTH_TOKEN = "test-fixed-token-for-pytest"
AUTH_HEADERS = {"Authorization": f"Bearer {AUTH_TOKEN}"}


def fake_embedding_vector(text: str) -> list[float]:
    vec = np.zeros(EMBED_DIM, dtype=np.float32)
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        idx = int(hashlib.md5(word.encode()).hexdigest(), 16) % EMBED_DIM
        vec[idx] += 1.0
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


@pytest.fixture(autouse=True)
def isolated_db_and_fake_embeddings(monkeypatch):
    sqlite_store.connect()
    conn = sqlite_store._conn
    conn.execute("DELETE FROM answers")
    conn.execute("DELETE FROM profile")
    conn.execute("DELETE FROM resumes")
    conn.commit()

    async def fake_generate_embedding(text: str):
        return fake_embedding_vector(text)

    async def fake_generate_embedding_batch(texts: list[str]):
        return [fake_embedding_vector(t) for t in texts]

    monkeypatch.setattr(memory_service, "generate_embedding", fake_generate_embedding)

    yield

    sqlite_store.close()
