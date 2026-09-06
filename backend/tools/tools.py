import json
import re

from strands import tool

from backend.memory.memory_service import find_similar, save_answer
from backend.memory.sqlite_store import sqlite_store

QUESTION_TYPE_PATTERNS = [
    (r"tell (me|us) about yourself|introduce yourself", "introduction"),
    (r"why (do you want|are you interested|should we hire)", "motivation"),
    (r"where do you see yourself|future goals|career goals", "career_goals"),
    (r"strength|weakness|best quality|area.?.?improve", "strengths_weaknesses"),
    (r"describe a time|tell me about a time|example of|situation where|behavioral", "behavioral"),
    (r"technical challenge|technical problem|difficult problem|complex project", "technical"),
    (r"why (are )?you leaving|reason for leaving", "resignation_reason"),
    (r"salary|compensation|expected|pay", "salary"),
    (r"available to start|start date|notice period|availability", "availability"),
    (r"work authorization|visa|sponsorship|legally authorized", "work_authorization"),
    (r"cover letter|why this role|why this position", "cover_letter"),
    (r"diversity|inclusion|equity", "diversity"),
    (r"teamwork|collaboration|work with others", "teamwork"),
    (r"leadership|manage|mentor", "leadership"),
    (r"conflict|disagreement|challenge with", "conflict_resolution"),
    (r"achievement|accomplishment|proud of", "achievement"),
    (r"customer|client|stakeholder", "customer_facing"),
    (r"project (you )?managed|project (you )?led", "project_management"),
    (r"fail|mistake|error|setback", "failure"),
]


def classify_field_heuristic(label: str, placeholder: str | None, field_type: str) -> dict:
    label_lower = (label or "").lower()
    placeholder_lower = (placeholder or "").lower()
    combined = f"{label_lower} {placeholder_lower}"

    generic_labels = {"type here", "enter text", "please enter", "input", "text", "enter", "edit",
                      "answer", "your answer", "write here", "your response", ""}
    if label_lower in generic_labels:
        type_map = {
            "email": ("static", "email", 0.85),
            "tel": ("static", "phone", 0.85),
            "url": ("static", "portfolio", 0.8),
            "date": ("static", "date", 0.75),
            "file": ("file_upload", None, 0.8),
            "number": ("static", "unknown", 0.6),
        }
        if field_type in type_map:
            cat, sub, conf = type_map[field_type]
            return {"category": cat, "subcategory": sub, "confidence": conf, "label": label}

    static_map = {
        "name": ["name", "full name", "first name", "last name", "middle name"],
        "email": ["email", "e-mail", "e mail"],
        "phone": ["phone", "telephone", "mobile", "cell", "phone number"],
        "address": ["address", "location", "city", "state", "zip", "postal", "country"],
        "linkedin": ["linkedin", "linked in", "linkedin url", "linkedin profile"],
        "github": ["github", "git hub", "github url", "github profile"],
        "portfolio": ["portfolio", "website", "url", "personal website", "link"],
    }

    for key, keywords in static_map.items():
        if any(kw in combined for kw in keywords):
            return {"category": "static", "subcategory": key, "confidence": 0.92, "label": label}

    if field_type == "file" or "resume" in combined or "cover" in combined:
        return {"category": "file_upload", "confidence": 0.9, "label": label}

    if field_type in ("select", "select-one", "select-multiple", "dropdown"):
        return {"category": "select", "confidence": 0.85, "label": label}

    if field_type == "checkbox":
        return {"category": "checkbox", "subcategory": "checkbox", "confidence": 0.95, "label": label}

    if field_type == "radio":
        return {"category": "checkbox", "subcategory": "radio", "confidence": 0.9, "label": label}

    salary_range_patterns = ["salary range", "salary and currency", "expected salary", "salary expectation", "compensation expected", "pay expectation"]
    if any(p in combined for p in salary_range_patterns) and field_type in ("textarea", "text", "unknown", ""):
        question_type = "general"
        for pattern, qtype in QUESTION_TYPE_PATTERNS:
            if re.search(pattern, combined):
                question_type = qtype
                break
        return {"category": "long_answer", "question_type": question_type, "confidence": 0.82, "label": label}

    short_field_keywords = [
        "ctc", "lpa", "salary", "compensation", "pay",
        "notice period", "availability", "start date", "available",
        "phone", "whatsapp", "mobile", "cell",
        "expected", "current", "inhand", "in hand",
        "lakhs", "lpa", "k per annum", "per annum",
        "years of experience", "total experience", "work experience",
        "education", "qualification", "degree", "college", "university",
        "graduation", "passing year", "year of passing",
        "language", "proficiency",
        "referral", "source", "how did you hear",
        "relocate", "relocation",
        "gender", "date of birth", "dob", "nationality",
        "+91", "code", "country code",
        "select2", "container",
        "select one", "choose one", "pick one", "select an option", "choose an option",
        "drop or select", ".doc", ".pdf", ".docx", "upload", "attach", "browse", "choose file",
        "recaptcha", "g-recaptcha", "captcha",
    ]
    if any(kw in combined for kw in short_field_keywords):
        qtype = "general"
        for pattern, qt in QUESTION_TYPE_PATTERNS:
            if re.search(pattern, combined):
                qtype = qt
                break
        return {"category": "static", "subcategory": qtype, "confidence": 0.9, "label": label}

    if field_type in ("textarea", "text") or len(label) > 15:
        question_type = "general"
        for pattern, qtype in QUESTION_TYPE_PATTERNS:
            if re.search(pattern, combined):
                question_type = qtype
                break
        return {"category": "long_answer", "question_type": question_type, "confidence": 0.78, "label": label}

    return {"category": "unknown", "confidence": 0.35, "label": label}


@tool
def retrieve_profile_tool(field: str | None = None) -> str:
    """Retrieve the user's stored profile information.

    Use this tool when you need to get the user's saved profile data
    for autofilling job application form fields.

    Args:
        field: Optional specific field to retrieve (name, email, phone, address, linkedin, github, portfolio, education, experience, skills).
               If omitted, returns the entire profile.
    """
    if field:
        val = sqlite_store.get_profile_key(field)
        return json.dumps({field: val}) if val else "{}"
    return json.dumps(sqlite_store.get_profile())


@tool
def save_profile_tool(key: str, value: str) -> str:
    """Save or update a field in the user's profile.

    Use this tool when the user provides new profile information.

    Args:
        key: The field name to save (name, email, phone, address, linkedin, github, portfolio, education, experience, skills).
        value: The value to store.
    """
    sqlite_store.set_profile(key, value)
    return json.dumps({"saved": key, "value": value})


@tool
async def retrieve_memory_tool(question: str, company: str | None = None, role: str | None = None, top_k: int = 3) -> str:
    """Retrieve similar past answers from memory using semantic search.

    Uses Qdrant vector database to find semantically similar questions
    and their approved answers. Results are ranked by cosine similarity.

    Args:
        question: The application question text to search for.
        company: Optional company name to filter by for company-specific answers.
        role: Optional job role to filter by for role-specific answers.
        top_k: Number of similar answers to retrieve (default 3, max 10).
    """
    results = await find_similar(question, company, role, min(top_k, 10))
    return json.dumps({"matches": results, "query": question[:100]})


@tool
async def save_memory_tool(question: str, answer: str, company: str, role: str, original_answer: str | None = None) -> str:
    """Save a question-answer pair to memory for future retrieval.

    Stores the answer in both SQLite and Qdrant vector database.
    The question is embedded using Ollama for semantic search.

    Args:
        question: The application question.
        answer: The final approved answer.
        company: Company name for context.
        role: Job role for context.
        original_answer: The originally generated answer before user edits (optional).
    """
    await save_answer(question, answer, company, role, original_answer=original_answer)
    return json.dumps({"saved": True, "question": question[:100]})


@tool
def classify_field_tool(label: str, placeholder: str | None = None, field_type: str = "text", context: str | None = None) -> str:
    """Classify a form field into a known category for autofill.

    Provides heuristic classification with confidence scoring.
    For low-confidence results, the agent should use its own reasoning to refine.

    Returns JSON with: category (static, file_upload, select, checkbox, long_answer, unknown),
    subcategory (specific field name or question type), confidence (0-1), and label.

    Args:
        label: The field label text visible to the user.
        placeholder: The field placeholder text (optional).
        field_type: The HTML field type (text, email, tel, select, textarea, checkbox, file, etc).
        context: Surrounding text or section heading from the page (optional).
    """
    result = classify_field_heuristic(label, placeholder, field_type)
    if context and result["confidence"] < 0.7:
        combined = f"{result.get('label','').lower()} {context.lower()}"
        for key, keywords in {
            "name": ["name", "full name"],
            "email": ["email"],
            "phone": ["phone", "telephone"],
            "resume": ["resume", "upload", "attach"],
        }.items():
            if any(kw in combined for kw in keywords):
                result["category"] = "static" if key != "resume" else "file_upload"
                result["subcategory"] = key
                result["confidence"] = min(result["confidence"] + 0.2, 0.95)
                break
    return json.dumps(result)


@tool
async def generate_answer_tool(question: str, profile: str, memories: str, job_description: str | None = None) -> str:
    """Generate a tailored answer for an open-ended application question.

    Uses the LLM (Ollama) to generate personalized answers incorporating
    the user's profile information and similar past answers from memory.

    Args:
        question: The application question to answer.
        profile: User profile information as JSON.
        memories: Similar past answers retrieved from memory as JSON.
        job_description: Optional job description for context in markdown.
    """
    from backend.answer_service import prepare_context

    result = await prepare_context(
        question=question,
        job_description=job_description or "",
    )
    return json.dumps({"prompt": result["prompt"], "systemPrompt": result["systemPrompt"]})


@tool
def fill_field_tool(selector: str, value: str) -> str:
    """Mark a form field to be filled with a value.

    The extension will execute this fill on the page.

    Args:
        selector: The CSS selector for the form field.
        value: The value to fill into the field.
    """
    return json.dumps({"filled": True, "selector": selector, "value": value[:50]})


@tool
def detect_job_site_tool(url: str) -> str:
    """Detect if the URL is a supported job application site.

    Args:
        url: The current page URL to analyze.
    """
    known_sites = [
        "myworkdayjobs.com", "greenhouse.io", "lever.co",
        "ashbyhq.com", "breezy.hr", "smartrecruiters.com",
        "linkedin.com/jobs", "icims.com", "taleo.net",
        "oraclecloud.com", "successfactors.com",
    ]
    matched = any(site in url.lower() for site in known_sites)
    return json.dumps({"supported": matched, "url": url[:100]})
