from fastapi import APIRouter, Depends, HTTPException

from backend.auth import require_auth
from backend.memory.memory_service import find_similar, find_similar_for_fields, update_answer
from backend.memory.sqlite_store import sqlite_store

router = APIRouter(prefix="/api/memory", dependencies=[Depends(require_auth)])


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


@router.put("/answers/{answer_id}")
async def edit_answer(answer_id: int, body: dict):
    final_answer = (body or {}).get("final_answer", "").strip()
    if not final_answer:
        raise HTTPException(400, "final_answer is required")

    updated = await update_answer(answer_id, final_answer)
    if not updated:
        raise HTTPException(404, "Answer not found")
    return {"id": answer_id, "final_answer": final_answer}


@router.delete("/answers/{answer_id}")
async def delete_answer(answer_id: int):
    deleted = sqlite_store.delete_answer(answer_id)
    if not deleted:
        raise HTTPException(404, "Answer not found")
    return {"deleted": answer_id}
