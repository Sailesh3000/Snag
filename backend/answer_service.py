import json
import logging

from backend.memory.memory_service import find_similar
from backend.memory.sqlite_store import sqlite_store
from backend.prompts.templates import ANSWER_SYSTEM, QUESTION_TEMPLATES

logger = logging.getLogger(__name__)

QUESTION_TYPE_KEYWORDS = {
    "introduction": ["tell me about yourself", "introduce yourself"],
    "motivation": ["why do you want", "why are you interested", "why this role", "why this company"],
    "behavioral": ["describe a time", "tell me about a time", "example of", "behavioral"],
    "technical": ["technical", "programming", "coding", "technology stack"],
    "salary": ["salary", "compensation", "expected pay"],
    "strengths_weaknesses": ["strength", "weakness", "best quality"],
    "cover_letter": ["cover letter", "why this position"],
}


def detect_question_type(question: str) -> str:
    q = question.lower()
    for qtype, keywords in QUESTION_TYPE_KEYWORDS.items():
        if any(kw in q for kw in keywords):
            return qtype
    return "general"


MAX_JOB_DESCRIPTION_CHARS = 3000


def build_prompt(question: str, profile: dict, memories: list[dict], job_description: str, company: str, role: str) -> tuple[str, str]:
    qtype = detect_question_type(question)
    template = QUESTION_TEMPLATES.get(qtype, QUESTION_TEMPLATES["general"])

    profile_str = json.dumps(profile, indent=2)
    skills = profile.get("skills", "")
    memories_str = json.dumps(memories, indent=2) if memories else "No past answers available."
    job_description = (job_description or "").strip()[:MAX_JOB_DESCRIPTION_CHARS]

    prompt = template.format(
        question=question,
        role=role or "the role",
        company=company or "the company",
        profile=profile_str,
        skills=skills,
        memories=memories_str,
        job_description=job_description or "Not provided.",
    )
    return prompt, qtype


async def prepare_context(
    question: str,
    company: str = "",
    role: str = "",
    job_description: str = "",
    session_id: str = "",
) -> dict:
    """Build prompt context for the extension to send to the LLM directly."""
    profile = sqlite_store.get_profile()
    memories = await find_similar(question, company, role, top_k=3)

    prompt, qtype = build_prompt(question, profile, memories, job_description, company, role)

    return {
        "systemPrompt": ANSWER_SYSTEM,
        "prompt": prompt,
        "questionType": qtype,
        "company": company,
        "role": role,
        "profileUsed": list(profile.keys()),
        "memoryCount": len(memories),
    }


async def save_answer(
    question: str,
    final_answer: str,
    company: str = "",
    role: str = "",
    session_id: str = "",
    original_answer: str | None = None,
):
    """Store a user-approved answer (accept, or edit-then-accept) in the database.

    Only ever called after the user has approved a fill — never for a raw
    generated draft the user hasn't reviewed yet.
    """
    from backend.memory.memory_service import save_answer as _save
    await _save(
        question=question,
        final_answer=final_answer,
        company=company,
        role=role,
        session_id=session_id,
        original_answer=original_answer,
        question_type=detect_question_type(question),
    )
