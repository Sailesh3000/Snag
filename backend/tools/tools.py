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
