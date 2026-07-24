import hashlib
import json
import logging
import sqlite3

import numpy as np

from backend.memory.embeddings import generate_embedding
from backend.memory.sqlite_store import sqlite_store

logger = logging.getLogger(__name__)


def _point_id(question: str, company: str, role: str) -> str:
    raw = f"{question}|{company}|{role}"
    return hashlib.md5(raw.encode()).hexdigest()


async def save_answer(
    question: str,
    final_answer: str,
    company: str = "",
    role: str = "",
    session_id: str = "",
    original_answer: str | None = None,
):
    embedding = await generate_embedding(question)
    embedding_json = json.dumps(embedding) if embedding else None

    sqlite_store.save_answer(
        session_id, question, final_answer, company, role, original_answer, embedding_json
    )
    logger.info(f"Saved memory: q={question[:50]}...")


async def find_similar(
    question: str,
    company: str | None = None,
    role: str | None = None,
    top_k: int = 3,
    min_score: float = 0.3,
) -> list[dict]:
    embedding = await generate_embedding(question)
    if not embedding:
        return []

    query_vec = np.array(embedding, dtype=np.float32)
    conn = sqlite_store._conn
    if not conn:
        return []

    sql = "SELECT id, session_id, question, final_answer, company, role, embedding FROM answers WHERE embedding IS NOT NULL"
    params: list = []
    if company:
        sql += " AND company = ?"
        params.append(company)
    if role:
        sql += " AND role = ?"
        params.append(role)
    sql += " ORDER BY created_at DESC LIMIT 100"

    cursor = conn.execute(sql, params)
    results = []
    for row in cursor.fetchall():
        try:
            stored_emb = np.array(json.loads(row["embedding"]), dtype=np.float32)
            score = float(np.dot(query_vec, stored_emb) / (np.linalg.norm(query_vec) * np.linalg.norm(stored_emb) + 1e-8))
            if score >= min_score:
                results.append({
                    "id": str(row["id"]),
                    "score": score,
                    "payload": {
                        "question": row["question"],
                        "answer": row["final_answer"],
                        "company": row["company"] or "",
                        "role": row["role"] or "",
                    },
                })
        except Exception:
            continue

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


NON_QUESTION_KEYWORDS = {
    "upload", "file", "drop", "select", "attach", "browse", "choose",
    "resume", "cv", "document", "pdf", "doc", "docx", "image", "photo",
    "screenshot", "recaptcha", "captcha", "robot", "verify", "security",
}


def _is_question_field(label: str) -> bool:
    label_lower = label.lower().strip()
    if len(label_lower) < 10:
        return False
    for kw in NON_QUESTION_KEYWORDS:
        if kw in label_lower:
            return False
    if label_lower.startswith("customquestions."):
        return False
    return True


async def find_similar_for_fields(fields: list[dict], top_k: int = 2) -> list[dict]:
    suggestions = []
    seen_answers: set[str] = set()
    for field in fields:
        label = field.get("label", "")
        if not _is_question_field(label):
            continue
        results = await find_similar(label, top_k=top_k)
        if not results:
            continue
        unique = []
        for r in results:
            ans_preview = r.get("payload", {}).get("answer", "")[:80]
            if ans_preview not in seen_answers:
                seen_answers.add(ans_preview)
                unique.append(r)
        if unique:
            suggestions.append({
                "fieldLabel": label,
                "matches": unique,
            })
    return suggestions
