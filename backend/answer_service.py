import json
import logging

from backend.llm_providers.provider_router import get_provider
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


def build_prompt(question: str, profile: dict, memories: list[dict], job_description: str, company: str, role: str) -> tuple[str, str]:
    qtype = detect_question_type(question)
    template = QUESTION_TEMPLATES.get(qtype, QUESTION_TEMPLATES["general"])

    profile_str = json.dumps(profile, indent=2)
    skills = profile.get("skills", "")
    memories_str = json.dumps(memories, indent=2) if memories else "No past answers available."

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


async def generate_answer(
    question: str,
    company: str = "",
    role: str = "",
    job_description: str = "",
    session_id: str = "",
    provider: str = "ollama",
    api_key: str = "",
    model: str = "",
    base_url: str = "",
) -> dict:
    profile = sqlite_store.get_profile()
    memories = await find_similar(question, company, role, top_k=3)

    prompt, qtype = build_prompt(question, profile, memories, job_description, company, role)

    llm = get_provider(provider=provider, api_key=api_key, model=model, base_url=base_url)

    draft = ""
    error = None
    try:
        draft = await llm.generate(system=ANSWER_SYSTEM, prompt=prompt)
    except Exception as e:
        error = f"Generation failed: {e}"
        logger.error(f"LLM generation failed ({provider}): {e}")

    if not draft and not error:
        error = "The LLM returned an empty response. Try rephrasing or check your API key."

    return {
        "question": question,
        "draft": draft,
        "error": error,
        "questionType": qtype,
        "company": company,
        "role": role,
        "confidence": 0.7 if len(draft) > 20 else 0.3,
        "profileUsed": list(profile.keys()),
        "memoryCount": len(memories),
    }


async def generate_answer_stream(
    question: str,
    company: str = "",
    role: str = "",
    job_description: str = "",
    provider: str = "ollama",
    api_key: str = "",
    model: str = "",
    base_url: str = "",
):
    profile = sqlite_store.get_profile()
    memories = await find_similar(question, company, role, top_k=3)

    prompt, qtype = build_prompt(question, profile, memories, job_description, company, role)

    yield json.dumps({"type": "meta", "questionType": qtype, "memoryCount": len(memories)}) + "\n"

    llm = get_provider(provider=provider, api_key=api_key, model=model, base_url=base_url)

    try:
        async for chunk in llm.generate_stream(system=ANSWER_SYSTEM, prompt=prompt):
            yield json.dumps({"type": "chunk", "text": chunk}) + "\n"
        yield json.dumps({"type": "done"}) + "\n"
    except Exception as e:
        yield json.dumps({"type": "error", "message": str(e)}) + "\n"
