from strands import Agent

from backend.tools.tools import (
    classify_field_tool,
    retrieve_profile_tool,
    save_profile_tool,
    retrieve_memory_tool,
    generate_answer_tool,
    fill_field_tool,
    save_memory_tool,
)


PAGE_AGENT_PROMPT = """You are a Page Agent specialized in understanding job application forms.

Given form field metadata, your job is to:
1. Classify each field using classify_field_tool
2. For fields with confidence < 0.7, use your own reasoning to improve the classification
   based on the label, placeholder, context, and field type
3. Detect multi-page forms and track form structure
4. Identify which fields are required vs optional

Field categories:
- static: Personal info fields (name, email, phone, address, LinkedIn, GitHub, portfolio)
- file_upload: Resume/CV and cover letter uploads
- select: Dropdown menus (country, state, education level, years of experience)
- checkbox: Terms, work authorization, sponsorship, equal opportunity
- long_answer: Open-ended questions, cover letters, descriptions
- unknown: When you cannot determine the category

For long_answer fields, also detect the question type:
- introduction, motivation, career_goals, strengths_weaknesses, behavioral,
  technical, salary, availability, work_authorization, cover_letter, diversity,
  teamwork, leadership, conflict_resolution, achievement, general

Output a structured classification for each field with confidence scores."""


def create_page_agent() -> Agent:
    return Agent(
        name="page_agent",
        system_prompt=PAGE_AGENT_PROMPT,
        tools=[classify_field_tool],
    )


PROFILE_AGENT_PROMPT = """You are a Profile Agent. You manage the user's stored profile information.

Use retrieve_profile_tool to get profile data for autofilling forms.
Use save_profile_tool when the user provides or updates their profile info.

Profile fields: name, email, phone, address, linkedin, github,
portfolio, education (JSON array), experience (JSON array), skills (JSON array)."""


def create_profile_agent() -> Agent:
    return Agent(
        name="profile_agent",
        system_prompt=PROFILE_AGENT_PROMPT,
        tools=[retrieve_profile_tool, save_profile_tool],
    )


MEMORY_AGENT_PROMPT = """You are a Memory Agent. Given a job application question, company, and role,
retrieve similar past answers from the vector database using retrieve_memory_tool.
Return the most relevant past answers to inform answer generation."""


def create_memory_agent() -> Agent:
    return Agent(
        name="memory_agent",
        system_prompt=MEMORY_AGENT_PROMPT,
        tools=[retrieve_memory_tool],
    )


ANSWER_AGENT_PROMPT = """You are an Answer Agent. Generate tailored answers for job application questions.

You will receive: the question, the user's profile, similar past answers from memory,
and optionally the job description. Use generate_answer_tool to produce the draft.

For short-answer static fields, just return the profile value.
For long_answer fields, generate personalized responses that:
- Match the question type (introduction, motivation, behavioral, etc.)
- Reference the user's actual experience from their profile
- Use past successful answers as style reference
- Are 2-4 paragraphs for open-ended questions
- Never fabricate experience or credentials"""


def create_answer_agent() -> Agent:
    return Agent(
        name="answer_agent",
        system_prompt=ANSWER_AGENT_PROMPT,
        tools=[generate_answer_tool],
    )


FILL_AGENT_PROMPT = """You are a Fill Agent. Fill form fields with approved values.
Use fill_field_tool to mark fields for filling. Verify that fills succeed."""


def create_fill_agent() -> Agent:
    return Agent(
        name="fill_agent",
        system_prompt=FILL_AGENT_PROMPT,
        tools=[fill_field_tool],
    )


LEARNING_AGENT_PROMPT = """You are a Learning Agent. After a user edits an AI-generated answer,
store the original and final answer using save_memory_tool
so the system improves over time."""


def create_learning_agent() -> Agent:
    return Agent(
        name="learning_agent",
        system_prompt=LEARNING_AGENT_PROMPT,
        tools=[save_memory_tool],
    )
