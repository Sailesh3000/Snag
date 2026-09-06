"""Semantic retrieval, cross-company adaptation, and dedup (Steps 3-4 of the
target UX): the core of the learning loop."""
import pytest

from backend.memory.memory_service import find_similar, save_answer
from backend.memory.sqlite_store import sqlite_store


@pytest.mark.asyncio
async def test_finds_paraphrased_question():
    await save_answer(
        question="Why do you want to work at this company",
        final_answer="Because your mission aligns with my values.",
        company="Acme",
        role="Engineer",
    )
    results = await find_similar("Why do you want to work here", top_k=3, min_score=0.2)
    assert any("mission aligns" in r["payload"]["answer"] for r in results)


@pytest.mark.asyncio
async def test_unrelated_question_is_not_matched():
    await save_answer(
        question="Why do you want to work at this company",
        final_answer="Because your mission aligns with my values.",
        company="Acme",
        role="Engineer",
    )
    results = await find_similar(
        "How many years of professional Python experience do you have",
        top_k=3,
        min_score=0.3,
    )
    assert all("mission aligns" not in r["payload"]["answer"] for r in results)


@pytest.mark.asyncio
async def test_approved_answer_is_retrievable_for_a_different_company():
    """Regression test for the P0 fix: retrieval used to hard-filter by exact
    company match, so a previously-approved answer could never surface for a
    new company. It must now surface (for the LLM to adapt), ranked by
    semantic similarity rather than gated by company equality."""
    await save_answer(
        question="Why do you want to work at Acme",
        final_answer="Acme's engineering culture matches how I like to build software.",
        company="Acme",
        role="Engineer",
    )
    results = await find_similar(
        "Why are you interested in joining our company",
        company="OtherCo",
        role="Engineer",
        top_k=3,
        min_score=0.2,
    )
    assert any(r["payload"]["company"] == "Acme" for r in results)


@pytest.mark.asyncio
async def test_same_company_match_ranks_above_cross_company_match_at_equal_similarity():
    await save_answer(
        question="Why do you want to join us",
        final_answer="Cross-company answer.",
        company="OtherCo",
        role="Engineer",
    )
    await save_answer(
        question="Why do you want to join us",
        final_answer="Same-company answer.",
        company="Acme",
        role="Engineer",
    )
    results = await find_similar("Why do you want to join us", company="Acme", role="Engineer", top_k=2, min_score=0.2)
    assert results[0]["payload"]["answer"] == "Same-company answer."


@pytest.mark.asyncio
async def test_accepting_the_same_question_twice_updates_not_duplicates():
    await save_answer(question="Describe a challenge you overcame", final_answer="Draft one.", company="Acme", role="Engineer")
    await save_answer(question="Describe a challenge you overcame", final_answer="Edited final version.", company="Acme", role="Engineer")

    cursor = sqlite_store._conn.execute(
        "SELECT final_answer FROM answers WHERE question = ? AND company = ?",
        ("Describe a challenge you overcame", "Acme"),
    )
    rows = cursor.fetchall()
    assert len(rows) == 1
    assert rows[0]["final_answer"] == "Edited final version."


@pytest.mark.asyncio
async def test_same_question_different_company_is_not_deduped():
    await save_answer(question="Why this role", final_answer="Answer for Acme.", company="Acme", role="Engineer")
    await save_answer(question="Why this role", final_answer="Answer for OtherCo.", company="OtherCo", role="Engineer")

    cursor = sqlite_store._conn.execute("SELECT company, final_answer FROM answers WHERE question = ?", ("Why this role",))
    rows = {row["company"]: row["final_answer"] for row in cursor.fetchall()}
    assert rows == {"Acme": "Answer for Acme.", "OtherCo": "Answer for OtherCo."}


@pytest.mark.asyncio
async def test_embedding_failure_degrades_gracefully(monkeypatch):
    from backend.memory import memory_service

    async def empty_embedding(_text: str):
        return []

    monkeypatch.setattr(memory_service, "generate_embedding", empty_embedding)
    results = await find_similar("Any question", top_k=3)
    assert results == []
