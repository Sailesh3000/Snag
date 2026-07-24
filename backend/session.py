import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class FieldInfo:
    field_id: str
    selector: str
    label: str
    placeholder: str | None
    field_type: str
    value: str | None = None
    required: bool = False
    context: str = ""
    field_index: int = 0
    parent_label: str | None = None

    @property
    def classification_key(self) -> str:
        return f"{self.label}|{self.placeholder or ''}|{self.field_type}"


@dataclass
class Classification:
    field_id: str
    category: str
    confidence: float
    subcategory: str | None = None
    question_type: str | None = None
    label: str = ""


@dataclass
class Session:
    id: str = field(default_factory=lambda: f"ses_{uuid.uuid4().hex[:12]}")
    url: str = ""
    company: str | None = None
    role: str | None = None
    fields: list[FieldInfo] = field(default_factory=list)
    classifications: list[Classification] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class SessionManager:
    def __init__(self):
        self._sessions: dict[str, Session] = {}

    def create(self, url: str = "") -> Session:
        session = Session(url=url)
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def update_fields(self, session_id: str, fields: list[FieldInfo]) -> Session | None:
        session = self.get(session_id)
        if session:
            session.fields = fields
        return session

    def update_classifications(self, session_id: str, classifications: list[Classification]):
        session = self.get(session_id)
        if session:
            session.classifications = classifications

    def delete(self, session_id: str):
        self._sessions.pop(session_id, None)


session_manager = SessionManager()
