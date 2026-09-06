"""Extract plain text from an uploaded resume file.

Deliberately dumb: pull raw text out of the file. Turning that text into
structured profile fields (name, education, experience, skills, ...) needs
real language understanding, so that step goes through the LLM — see
backend/resume_service.py — the same BYOK path already used for answer
generation, not a second parsing/LLM stack.
"""
from pathlib import Path

MAX_RESUME_TEXT_CHARS = 8000


class ResumeParseError(Exception):
    pass


def extract_text(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower()

    if suffix == ".pdf":
        text = _extract_pdf_text(content)
    elif suffix in (".txt", ".md"):
        text = _decode_text(content)
    else:
        raise ResumeParseError(
            f"Unsupported resume file type: {suffix or 'unknown'}. Supported: .pdf, .txt, .md"
        )

    text = text.strip()
    if not text:
        raise ResumeParseError("Couldn't extract any text from this file.")
    return text[:MAX_RESUME_TEXT_CHARS]


def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return content.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    raise ResumeParseError("Couldn't decode this file as text.")


def _extract_pdf_text(content: bytes) -> str:
    import io

    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(content))
        pages = [page.extract_text() or "" for page in reader.pages]
    except PdfReadError as e:
        raise ResumeParseError(f"Couldn't read this PDF: {e}")
    return "\n".join(pages)
