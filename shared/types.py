from dataclasses import dataclass, field


@dataclass
class FieldInfo:
    field_id: str
    selector: str
    label: str
    placeholder: str | None
    field_type: str
    value: str | None = None


@dataclass
class PageUpdate:
    url: str
    fields: list[FieldInfo]
    job_title: str | None = None
    company: str | None = None


@dataclass
class DraftAnswer:
    field_id: str
    question: str
    draft: str
    confidence: float
    sources: list[str] = field(default_factory=list)


@dataclass
class AnswerEdit:
    field_id: str
    question: str
    original: str
    edited: str


@dataclass
class FillExecution:
    field_id: str
    value: str
    success: bool
    error: str | None = None
