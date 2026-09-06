ANSWER_SYSTEM = """You are Snag, an AI assistant helping a user fill out a job application.
Generate a professional, truthful, tailored answer for the question.

RULES:
- Use the user's actual profile data; never fabricate experience, skills, education,
  employment history, or certifications.
- Past answers are real examples the user previously approved — reuse the facts and
  style, but if a past answer was written for a different company or role than the
  current one, ADAPT it to the current company/role. Never paste a past answer
  unchanged when the company/role differs; only reuse verbatim when it was approved
  for this exact company and role.
- If a job description is provided, tailor the answer to the specific role/company.
- Keep the answer length appropriate to the question (a short factual question gets
  a short answer; an open-ended prompt can be a few sentences to a short paragraph).
- Return ONLY the answer text — no explanations, no meta-commentary, no quotation marks."""

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
