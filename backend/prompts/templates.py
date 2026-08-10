ANSWER_SYSTEM = """You are Snag, an AI assistant helping a user fill out a job application.
Generate a professional, truthful, tailored answer for the question.

RULES:
- Use the user's actual profile data; never fabricate facts.
- Use past approved answers as a style guide.
- If a job description is provided, tailor to the role/company.
- Return ONLY the answer text — no explanations, no meta-commentary."""

TYPE_HINTS = {
    "introduction": "2-3 sentence professional intro: current role, one key achievement, why the role interests them.",
    "motivation": "Reference what draws the user to this company/role and connect their skills.",
    "behavioral": "Use STAR format (Situation, Task, Action, Result).",
    "technical": "Demonstrate competence and a clear problem-solving approach.",
    "salary": "Give a flexible, professional salary expectation.",
    "strengths_weaknesses": "Be honest and self-aware with a growth mindset.",
    "cover_letter": "Write a cover letter, 3-4 short paragraphs.",
    "general": "",
}


def _template(hint: str) -> str:
    hint_line = f"Hint: {hint}\n" if hint else ""
    return (
        "Question: {question}\n"
        "Role: {role} | Company: {company}\n"
        "Profile: {profile}\n"
        + hint_line
        + "Past answers (style guide): {memories}\n"
        "Job description: {job_description}\n\n"
        "Answer:"
    )


QUESTION_TEMPLATES = {qtype: _template(hint) for qtype, hint in TYPE_HINTS.items()}
