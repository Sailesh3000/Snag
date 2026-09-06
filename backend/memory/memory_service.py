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
    question_type: str | None = None,
):
    embedding = await generate_embedding(question)
    embedding_json = json.dumps(embedding) if embedding else None
    embedding_id = _point_id(question, company, role)

    sqlite_store.save_answer(
        session_id, question, final_answer, company, role, original_answer,
        embedding_json, embedding_id, question_type,
    )
    logger.info(f"Saved memory: q={question[:50]}...")


# Same-company/role matches are ranked slightly higher (they're more likely to be
# directly reusable) but a cross-company match still wins on strong semantic
# similarity — this is what lets a previously-approved "why this company" answer
# surface for a brand-new company so the LLM can adapt it instead of that
# history being invisible to retrieval.
COMPANY_BOOST = 0.05
ROLE_BOOST = 0.03


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

    cursor = conn.execute(
        "SELECT id, session_id, question, final_answer, company, role, embedding, question_type "
        "FROM answers WHERE embedding IS NOT NULL ORDER BY created_at DESC LIMIT 200"
    )
    results = []
    for row in cursor.fetchall():
        try:
            stored_emb = np.array(json.loads(row["embedding"]), dtype=np.float32)
            score = float(np.dot(query_vec, stored_emb) / (np.linalg.norm(query_vec) * np.linalg.norm(stored_emb) + 1e-8))
        except Exception:
            continue
        if score < min_score:
            continue

        rank_score = score
        if company and row["company"] == company:
            rank_score += COMPANY_BOOST
        if role and row["role"] == role:
            rank_score += ROLE_BOOST

        results.append({
            "id": str(row["id"]),
            "score": score,
            "rank_score": rank_score,
            "payload": {
                "question": row["question"],
                "answer": row["final_answer"],
                "company": row["company"] or "",
                "role": row["role"] or "",
                "questionType": row["question_type"] or "",
            },
        })

    results.sort(key=lambda x: x["rank_score"], reverse=True)
    for r in results:
        del r["rank_score"]
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
