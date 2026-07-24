ANSWER_SYSTEM = """You are ApplyPilot, an AI assistant helping a user fill out a job application.
Generate a professional, truthful, tailored answer for the specific question.

RULES:
- Never fabricate experience, credentials, or education.
- Be concise — match the expected length of the question.
- Use the user's actual profile data (skills, experience, education).
- Reference similar past answers the user has approved as a style guide.
- If a job description is provided, tailor the answer to the role/company.
- Return ONLY the answer text — no explanations, no meta-commentary."""

QUESTION_TEMPLATES = {
    "introduction": """Question: Tell us about yourself.
Context: The user is applying for {role} at {company}.

Profile: {profile}
Past answers (style reference): {memories}
Job description: {job_description}

Write a 2-3 paragraph professional introduction that:
1. Opens with current role and a key achievement
2. Connects experience to the target role
3. Closes with enthusiasm for the opportunity""",

    "motivation": """Question: Why do you want to work here?
Context: The user is applying for {role} at {company}.

Profile: {profile}
Past answers (style reference): {memories}
Job description: {job_description}

Write a 1-2 paragraph answer that:
1. References specific aspects of {company}'s work
2. Connects the user's skills to the company's needs
3. Shows genuine interest""",

    "behavioral": """Question: {question}
Context: The user is applying for {role} at {company}.

Profile: {profile}
Past answers (style reference): {memories}

Write a STAR-format answer (Situation, Task, Action, Result) that:
1. Describes a specific situation from the user's experience
2. Uses real details from their profile
3. Quantifies results where possible""",

    "technical": """Question: {question}
Context: The user is applying for {role} at {company}.

Profile: {profile} (skills: {skills})
Past answers (style reference): {memories}

Write a technical answer that demonstrates competency and problem-solving approach.""",

    "salary": """Question: {question}
The user's profile info: {profile}

Generate a professional response about salary expectations that is flexible but grounded.""",

    "strengths_weaknesses": """Question: {question}
Profile: {profile}

Write an honest, self-aware answer that shows growth mindset.""",

    "cover_letter": """Write a cover letter for {role} at {company}.

Profile: {profile}
Past answers (style reference): {memories}
Job description: {job_description}

Write 3-4 paragraphs. Open strong, connect experience to role, close with call to action.""",

    "general": """Question: {question}
Context: The user is applying for {role} at {company}.

Profile: {profile}
Past answers (style reference): {memories}
Job description: {job_description}

This is a form field labeled "{question}". Determine what information is being asked for
based on the field label and the user's profile, then provide the appropriate answer.
For short fields (like a name, title, or single value), give a concise one-line answer.
For open-ended questions, write 1-2 paragraphs.""",
}
