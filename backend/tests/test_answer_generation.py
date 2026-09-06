"""Prompt construction for answer generation (Step 2/4 of the target UX).

The backend never calls an LLM itself (the extension does, BYOK) — its job is
to build the system+user prompt handed to whichever provider the user
configured. These tests cover that context-building pipeline.
"""
import pytest

from backend.answer_service import build_prompt, detect_question_type, prepare_context, save_answer
from backend.memory.sqlite_store import sqlite_store


def test_build_prompt_embeds_actual_question_verbatim():
    prompt, qtype = build_prompt(
        question="Why do you want to work at Acme?",
        profile={"first_name": "Ada"},
        memories=[],
        job_description="",
        company="Acme",
        role="Engineer",
    )
    assert "Why do you want to work at Acme?" in prompt
    assert qtype == "motivation"


def test_build_prompt_includes_profile_and_job_context():
    prompt, _ = build_prompt(
        question="Tell me about yourself",
        profile={"skills": "Python, SQL"},
        memories=[],
        job_description="Build data pipelines.",
        company="Acme",
        role="Data Engineer",
    )
    assert "Python, SQL" in prompt
    assert "Build data pipelines." in prompt
    assert "Acme" in prompt
    assert "Data Engineer" in prompt


def test_build_prompt_truncates_long_job_description():
    from backend.answer_service import MAX_JOB_DESCRIPTION_CHARS

    huge_description = "x" * (MAX_JOB_DESCRIPTION_CHARS + 500)
    prompt, _ = build_prompt(
        question="Tell me about yourself",
        profile={},
        memories=[],
        job_description=huge_description,
        company="Acme",
        role="Engineer",
    )
    assert "x" * (MAX_JOB_DESCRIPTION_CHARS + 500) not in prompt
    assert "x" * MAX_JOB_DESCRIPTION_CHARS in prompt


def test_build_prompt_without_job_description_uses_fallback_not_blank():
    prompt, _ = build_prompt(
        question="Tell me about yourself",
        profile={},
        memories=[],
        job_description="",
        company="",
        role="",
    )
    assert "Not provided." in prompt


@pytest.mark.asyncio
async def test_prepare_context_surfaces_cross_company_memory_for_generation():
    sqlite_store.set_profile("first_name", "Ada")
    await save_answer(
        question="Why do you want to work at Acme",
        final_answer="Acme's engineering culture matches how I like to build software.",
        company="Acme",
        role="Engineer",
    )

    ctx = await prepare_context(
        question="Why are you interested in joining our company",
        company="OtherCo",
        role="Engineer",
    )

    assert ctx["memoryCount"] >= 1
    assert "first_name" in ctx["profileUsed"]
    assert "Why are you interested in joining our company" in ctx["prompt"]
    assert ctx["systemPrompt"]  # never empty — the model must have real instructions


@pytest.mark.asyncio
async def test_prepare_context_handles_no_profile_and_no_memory_gracefully():
    ctx = await prepare_context(question="Describe your ideal work environment")
    assert ctx["memoryCount"] == 0
    assert ctx["profileUsed"] == []
    assert "Describe your ideal work environment" in ctx["prompt"]
