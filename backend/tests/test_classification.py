"""Field classification and question-type detection (heuristic layer)."""
from backend.answer_service import detect_question_type
from backend.api.ws import SENSITIVE_STATIC_KEYS, STATIC_FIELD_KEYWORDS, match_static_fields
from backend.session import FieldInfo
from backend.memory.sqlite_store import sqlite_store
from backend.tools.tools import classify_field_heuristic


def test_classifies_static_email_field():
    result = classify_field_heuristic("Email Address", "you@example.com", "email")
    assert result["category"] == "static"
    assert result["subcategory"] == "email"


def test_classifies_select_dropdown():
    # A dropdown whose label doesn't match any known static/short-field keyword
    # falls through to the field_type-driven "select" category.
    result = classify_field_heuristic("Preferred Team", None, "select")
    assert result["category"] == "select"


def test_classifies_checkbox():
    result = classify_field_heuristic("I agree to the terms", None, "checkbox")
    assert result["category"] == "checkbox"
    assert result["subcategory"] == "checkbox"


def test_classifies_radio():
    result = classify_field_heuristic("Yes", None, "radio")
    assert result["category"] == "checkbox"
    assert result["subcategory"] == "radio"


def test_classifies_file_upload():
    result = classify_field_heuristic("Upload your resume", None, "file")
    assert result["category"] == "file_upload"


def test_classifies_long_answer_question():
    result = classify_field_heuristic("Why do you want to work at this company?", None, "textarea")
    assert result["category"] == "long_answer"
    assert result["question_type"] == "motivation"


def test_low_confidence_unknown_does_not_raise():
    result = classify_field_heuristic("", None, "")
    assert result["category"] == "unknown"
    assert 0 <= result["confidence"] <= 1


def test_question_type_recognizes_paraphrased_motivation_questions():
    variants = [
        "Why do you want to work at this company?",
        "Why are you interested in this role?",
        "Why this company?",
    ]
    for q in variants:
        assert detect_question_type(q) == "motivation"


def test_question_type_recognizes_introduction_questions():
    assert detect_question_type("Tell me about yourself") == "introduction"
    assert detect_question_type("Introduce yourself") == "introduction"


def test_question_type_falls_back_to_general():
    assert detect_question_type("What is your favorite color?") == "general"


def test_sensitive_static_fields_classify_static_not_dead_end():
    """work authorization / visa / gender / DOB have a real profile field
    (unlike e.g. salary) so they should classify as static, not fall through
    to unknown/long_answer."""
    for label, field_type in [
        ("Are you legally authorized to work in this country?", "radio"),
        ("Do you require visa sponsorship?", "radio"),
        ("Gender", "select"),
        ("Date of Birth", "date"),
    ]:
        result = classify_field_heuristic(label, None, field_type)
        assert result["category"] == "static", f"{label!r} -> {result}"
        assert result["subcategory"] in STATIC_FIELD_KEYWORDS


def test_salary_and_notice_period_route_to_long_answer_not_dead_static():
    """No profile field backs these — they must flow into the reviewable
    LLM pipeline instead of a 'static' category nothing can fill."""
    for label in ["Expected Salary", "Notice Period", "Years of Python Experience"]:
        result = classify_field_heuristic(label, None, "text")
        assert result["category"] == "long_answer", f"{label!r} -> {result}"


def test_sensitive_matches_are_suggestions_not_auto_fills():
    sqlite_store.set_profile("work_authorization", "Authorized to work in the US")
    sqlite_store.set_profile("first_name", "Ada")

    fields = [
        FieldInfo(field_id="f1", selector="#work-auth", label="Work Authorization", placeholder=None, field_type="text"),
        FieldInfo(field_id="f2", selector="#first-name", label="First Name", placeholder=None, field_type="text"),
    ]
    fills, sensitive = match_static_fields(fields)

    fill_keys = {f["key"] for f in fills}
    sensitive_keys = {s["key"] for s in sensitive}

    assert "first_name" in fill_keys
    assert "work_authorization" not in fill_keys
    assert "work_authorization" in sensitive_keys
    assert SENSITIVE_STATIC_KEYS.issuperset(sensitive_keys)
