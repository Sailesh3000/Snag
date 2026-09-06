"""Build the prompt that asks the LLM to pull structured profile fields out
of resume text. The backend never calls an LLM itself (see answer_service.py)
— this returns systemPrompt/prompt for the extension to send to whichever
provider the user configured, same pattern as answer generation.
"""


def build_resume_extraction_prompt(resume_text: str) -> str:
    return f"Resume text:\n\n{resume_text}\n\nExtract the fields now."
