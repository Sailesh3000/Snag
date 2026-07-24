from fastapi import APIRouter

from backend.memory.memory_service import find_similar, find_similar_for_fields
from backend.memory.sqlite_store import sqlite_store

router = APIRouter(prefix="/api/memory")


@router.get("/answers")
async def get_answers():
    conn = sqlite_store._conn
    if not conn:
        return []
    cursor = conn.execute(
        "SELECT id, question, final_answer, company, role, created_at FROM answers ORDER BY created_at DESC LIMIT 50"
    )
    return [dict(row) for row in cursor.fetchall()]


@router.get("/similar")
async def similar(question: str, company: str | None = None, role: str | None = None, top_k: int = 3):
    results = await find_similar(question, company, role, top_k)
    return {"results": results}
