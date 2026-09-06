"""Resume text extraction (.pdf/.txt) feeding the LLM-based profile-field
extraction (backend/resume_service.py)."""
import io

import pytest

from backend.resume_parser import ResumeParseError, extract_text


def _make_pdf(text: str) -> bytes:
    """Build a minimal, syntactically valid single-page PDF containing `text`."""
    objs = []
    objs.append(b"<</Type/Catalog/Pages 2 0 R>>")
    objs.append(b"<</Type/Pages/Kids[3 0 R]/Count 1>>")
    objs.append(b"<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 200 200]/Contents 5 0 R>>")
    objs.append(b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>")
    stream = f"BT /F1 12 Tf 10 100 Td ({text}) Tj ET".encode()
    objs.append(b"<</Length %d>>\nstream\n" % len(stream) + stream + b"\nendstream")

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj".encode() + body + b"endobj\n")
    xref_offset = out.tell()
    n = len(objs) + 1
    out.write(f"xref\n0 {n}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer<</Size {n}/Root 1 0 R>>\nstartxref\n{xref_offset}\n%%EOF".encode())
    return out.getvalue()


def _make_blank_pdf() -> bytes:
    return _make_pdf("")


def test_extracts_text_from_plain_txt():
    text = extract_text("resume.txt", "Ada Lovelace\nSoftware Engineer".encode("utf-8"))
    assert "Ada Lovelace" in text


def test_extracts_text_from_pdf():
    pdf_bytes = _make_pdf("Ada Lovelace - Software Engineer")
    text = extract_text("resume.pdf", pdf_bytes)
    assert "Ada Lovelace" in text


def test_falls_back_to_latin1_for_non_utf8_bytes():
    raw = "café résumé".encode("latin-1")
    text = extract_text("resume.txt", raw)
    assert "caf" in text


def test_unsupported_extension_raises():
    with pytest.raises(ResumeParseError):
        extract_text("resume.docx", b"whatever")


def test_pdf_with_no_extractable_text_raises():
    with pytest.raises(ResumeParseError):
        extract_text("resume.pdf", _make_blank_pdf())


def test_truncates_very_long_text():
    from backend.resume_parser import MAX_RESUME_TEXT_CHARS

    huge = "x" * (MAX_RESUME_TEXT_CHARS + 500)
    text = extract_text("resume.txt", huge.encode("utf-8"))
    assert len(text) == MAX_RESUME_TEXT_CHARS
