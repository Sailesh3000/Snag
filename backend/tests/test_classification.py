"""Field classification and question-type detection (heuristic layer)."""
from backend.answer_service import detect_question_type
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
