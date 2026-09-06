import re

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
        # These map to real profile fields the user filled in directly (plain
        # strings, safe to reuse verbatim) — but see SENSITIVE_STATIC_KEYS in
        # ws.py: work_authorization/visa_status/gender/date_of_birth are
        # surfaced for one-click review rather than auto-filled instantly.
        "gender": ["gender", "sex"],
        "date_of_birth": ["date of birth", "dob", "birth date"],
        "willing_to_relocate": ["relocate", "relocation", "willing to relocate"],
        "work_authorization": ["work authorization", "authorized to work", "legally authorized to work", "eligible to work"],
        "visa_status": ["visa status", "visa sponsorship", "require sponsorship", "need sponsorship"],
    }

    for key, keywords in static_map.items():
        if any(kw in combined for kw in keywords):
            return {"category": "static", "subcategory": key, "confidence": 0.92, "label": label}

    file_upload_keywords = ["resume", "cover", "upload", "attach", "browse", "choose file", ".doc", ".pdf", ".docx"]
    if field_type == "file" or any(kw in combined for kw in file_upload_keywords):
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

    # These are real application questions with NO direct profile field to
    # copy a value from (salary/notice-period expectations aren't stored at
    # all) or whose profile field is structured data (education/experience
    # are JSON arrays) that needs summarizing into prose to answer a specific
    # question ("years of Python experience?"). Both cases need the LLM —
    # given the full profile JSON in the prompt — not a blind static copy, so
    # route them into the reviewable long_answer pipeline instead of a
    # "static" category nothing can actually fill.
    llm_answerable_short_fields = [
        "ctc", "lpa", "salary", "compensation", "pay",
        "notice period", "availability", "start date", "available",
        "expected", "current", "inhand", "in hand",
        "lakhs", "k per annum", "per annum",
        "years of experience", "total experience", "work experience",
        "education", "qualification", "degree", "college", "university",
        "graduation", "passing year", "year of passing",
        "language", "proficiency",
        "referral", "source", "how did you hear",
        "nationality",
    ]
    if any(kw in combined for kw in llm_answerable_short_fields):
        qtype = "general"
        for pattern, qt in QUESTION_TYPE_PATTERNS:
            if re.search(pattern, combined):
                qtype = qt
                break
        return {"category": "long_answer", "question_type": qtype, "confidence": 0.8, "label": label}

    if field_type in ("textarea", "text") or len(label) > 15:
        question_type = "general"
        for pattern, qtype in QUESTION_TYPE_PATTERNS:
            if re.search(pattern, combined):
                question_type = qtype
                break
        return {"category": "long_answer", "question_type": question_type, "confidence": 0.78, "label": label}

    return {"category": "unknown", "confidence": 0.35, "label": label}
