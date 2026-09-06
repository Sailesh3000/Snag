import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.answer_service import prepare_context, save_answer
from backend.auth import require_ws_auth
from backend.memory.memory_service import find_similar_for_fields
from backend.memory.sqlite_store import sqlite_store
from backend.session import Classification, FieldInfo, session_manager
from backend.tools.tools import classify_field_heuristic

logger = logging.getLogger(__name__)
ws_router = APIRouter()

STATIC_FIELD_KEYWORDS = {
    "first_name": ["first name", "given name", "local given name"],
    "last_name": ["last name", "family name", "surname", "local family name"],
    "name": ["full name"],
    "email": ["email", "e-mail", "e mail"],
    "phone": ["phone", "telephone", "mobile", "cell"],
    "city": ["city", "town", "locality"],
    "state": ["state", "province", "region"],
    "zip_code": ["zip", "postal", "zipcode", "zip code", "postal code", "pincode"],
    "country": ["country", "nation"],
    "address": ["address", "location", "street", "line 1", "line 2"],
    "linkedin": ["linkedin", "linked in"],
    "github": ["github", "git hub"],
    "portfolio": ["portfolio", "website", "url", "link"],
    "gender": ["gender", "sex"],
    "date_of_birth": ["date of birth", "dob", "birth date"],
    "willing_to_relocate": ["relocate", "relocation", "willing to relocate"],
    "work_authorization": ["work authorization", "authorized to work", "legally authorized to work", "eligible to work"],
    "visa_status": ["visa status", "visa sponsorship", "require sponsorship", "need sponsorship"],
}

# Legally/personally sensitive fields are never silently auto-filled, even
# though Snag has a direct, confident profile value for them. They're
# surfaced as a reviewable suggestion (same Accept/Edit/Skip flow as a
# generated answer) instead of being written into the DOM unattended.
SENSITIVE_STATIC_KEYS = {"work_authorization", "visa_status", "gender", "date_of_birth"}


def match_static_fields(fields: list[FieldInfo]) -> tuple[list[dict], list[dict]]:
    """Returns (auto_fills, sensitive_suggestions)."""
    profile = sqlite_store.get_profile()
    first_name = profile.get("first_name", "")
    last_name = profile.get("last_name", "")
    full_name = profile.get("name", "")

    if not first_name and not last_name and full_name:
        parts = full_name.strip().split(None, 1)
        first_name = parts[0] if parts else ""
        last_name = parts[1] if len(parts) > 1 else ""

    if not full_name and first_name:
        full_name = f"{first_name} {last_name}".strip()

    name_map = {
        "first_name": first_name,
        "last_name": last_name,
        "name": full_name,
    }

    generic_labels = {"type here", "enter text", "please enter", "input", "text", "enter", "edit",
                      "answer", "your answer", "write here", "your response", ""}

    fills: list[dict] = []
    sensitive: list[dict] = []

    def _emit(field: FieldInfo, profile_key: str, val: str):
        entry = {
            "fieldId": field.field_id,
            "selector": field.selector,
            "label": field.label,
            "value": val,
            "key": profile_key,
        }
        (sensitive if profile_key in SENSITIVE_STATIC_KEYS else fills).append(entry)

    for field in fields:
        label_lower = (field.label or "").lower()
        matched = False

        for profile_key, keywords in STATIC_FIELD_KEYWORDS.items():
            if any(kw in label_lower for kw in keywords):
                val = name_map[profile_key] if profile_key in name_map else profile.get(profile_key)
                if val:
                    _emit(field, profile_key, val)
                matched = True
                break

        if not matched and label_lower in generic_labels:
            type_profile_map = {
                "email": "email",
                "tel": "phone",
                "url": "portfolio",
            }
            profile_key = type_profile_map.get(field.field_type)
            if profile_key:
                val = profile.get(profile_key)
                if val:
                    _emit(field, profile_key, val)

    return fills, sensitive


def classify_fields(fields: list[FieldInfo]) -> list[Classification]:
    classifications = []
    for field in fields:
        result = classify_field_heuristic(field.label, field.placeholder, field.field_type)
        classifications.append(Classification(
            field_id=field.field_id,
            category=result["category"],
            confidence=result["confidence"],
            subcategory=result.get("subcategory"),
            question_type=result.get("question_type"),
            label=field.label,
        ))
    return classifications


class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, WebSocket] = {}

    async def connect(self, session_id: str, ws: WebSocket):
        await ws.accept()
        self._connections[session_id] = ws
        logger.info(f"WS connected: {session_id}")

    def disconnect(self, session_id: str):
        self._connections.pop(session_id, None)

    async def send(self, session_id: str, message: dict):
        ws = self._connections.get(session_id)
        if ws:
            await ws.send_json(message)


manager = ConnectionManager()

# Requests currently mid-flight between "user clicked Accept" and "content
# script confirmed the DOM write succeeded" — save_answer() only runs once
# that confirmation arrives, keyed by the requestId the sidebar generated.
# Cleaned up on WS disconnect (_purge_pending_fills_for_session) so a session
# that closes mid-fill can't leak entries forever.
pending_fills: dict[str, dict] = {}


def _purge_pending_fills_for_session(session_id: str) -> None:
    stale = [rid for rid, req in pending_fills.items() if req.get("session_id") == session_id]
    for rid in stale:
        pending_fills.pop(rid, None)


@ws_router.websocket("/ws/{session_id}")
async def websocket_endpoint(ws: WebSocket, session_id: str):
    if not await require_ws_auth(ws):
        await ws.close(code=4401)
        return

    await manager.connect(session_id, ws)
    session = session_manager.get(session_id) or session_manager.create()

    await manager.send(session_id, {
        "type": "status:update",
        "payload": {"connected": True, "sessionId": session.id},
    })

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")
            payload = data.get("payload", {})

            if msg_type == "page:update":
                session = session_manager.get(session_id) or session_manager.create(payload.get("url", ""))
                session.url = payload.get("url", "")
                session.company = payload.get("company")
                session.role = payload.get("jobTitle")
                session.job_description = payload.get("jobDescription")
                fields = [
                    FieldInfo(
                        field_id=f.get("id", ""),
                        selector=f.get("selector", ""),
                        label=f.get("label", ""),
                        placeholder=f.get("placeholder"),
                        field_type=f.get("type", "unknown"),
                        required=f.get("required", False),
                        context=f.get("context", ""),
                        field_index=f.get("fieldIndex", i),
                        parent_label=f.get("parentLabel"),
                    )
                    for i, f in enumerate(payload.get("fields", []))
                ]
                session_manager.update_fields(session_id, fields)

                classifications = classify_fields(fields)
                session_manager.update_classifications(session_id, classifications)

                await manager.send(session_id, {
                    "type": "fields:classified",
                    "payload": {
                        "classifications": [
                            {
                                "fieldId": c.field_id,
                                "selector": next((f.selector for f in fields if f.field_id == c.field_id), ""),
                                "category": c.category,
                                "confidence": c.confidence,
                                "subcategory": c.subcategory,
                                "questionType": c.question_type,
                                "label": c.label,
                            }
                            for c in classifications
                        ]
                    },
                })

                fills, sensitive_suggestions = match_static_fields(fields)
                if fills:
                    await manager.send(session_id, {
                        "type": "profile:fills",
                        "payload": {"fills": fills},
                    })
                if sensitive_suggestions:
                    await manager.send(session_id, {
                        "type": "static:suggestions",
                        "payload": {"suggestions": sensitive_suggestions},
                    })

                category_counts: dict[str, int] = {}
                for c in classifications:
                    category_counts[c.category] = category_counts.get(c.category, 0) + 1

                await manager.send(session_id, {
                    "type": "status:update",
                    "payload": {
                        "connected": True,
                        "sessionId": session.id,
                        "fieldCount": len(fields),
                        "staticMatchCount": len(fills),
                        "categoryCounts": category_counts,
                    },
                })

                long_answer_fields = [
                    {"label": c.label, "fieldId": c.field_id}
                    for c in classifications
                    if c.category == "long_answer" and c.confidence >= 0.7
                ]
                if long_answer_fields:
                    suggestions = await find_similar_for_fields(long_answer_fields, top_k=2)
                    if suggestions:
                        await manager.send(session_id, {
                            "type": "memory:suggestions",
                            "payload": {"suggestions": suggestions},
                        })

            elif msg_type == "answer:generate":
                result = await prepare_context(
                    question=payload.get("question", ""),
                    company=payload.get("company", "") or (session.company or ""),
                    role=payload.get("role", "") or (session.role or ""),
                    job_description=payload.get("jobDescription", "") or (session.job_description or ""),
                    session_id=session_id,
                )
                await manager.send(session_id, {
                    "type": "answer:context",
                    "payload": result,
                })

            elif msg_type == "fill:preview":
                await manager.send(session_id, {
                    "type": "fill:preview",
                    "payload": {
                        "fieldId": payload.get("fieldId"),
                        "selector": payload.get("selector"),
                        "label": payload.get("label"),
                        "value": payload.get("value"),
                    },
                })

            elif msg_type == "fill:approve":
                # Accept does NOT save to memory yet — only once the content
                # script confirms the DOM write actually succeeded (see
                # "fill:result" below) do we call save_answer(). This is the
                # fix for "Filled & Saved" being shown/stored before the
                # browser ever confirmed the field was filled.
                request_id = payload.get("requestId") or f"req_{uuid.uuid4().hex[:12]}"
                pending_fills[request_id] = {
                    "session_id": session_id,
                    "question": payload.get("question", ""),
                    "final_answer": payload.get("value", ""),
                    "company": payload.get("company", "") or (session.company or ""),
                    "role": payload.get("role", "") or (session.role or ""),
                    "original_answer": payload.get("original"),
                }
                await manager.send(session_id, {
                    "type": "fill:instruct",
                    "payload": {
                        "requestId": request_id,
                        "fieldId": payload.get("fieldId"),
                        "selector": payload.get("selector"),
                        "label": payload.get("question"),
                        "value": payload.get("value"),
                    },
                })

            elif msg_type == "fill:result":
                # The content script's true report of whether applyFill()
                # actually located and wrote the field.
                request_id = payload.get("requestId")
                success = bool(payload.get("success"))
                pending = pending_fills.pop(request_id, None) if request_id else None

                if success and pending:
                    await save_answer(
                        question=pending["question"],
                        final_answer=pending["final_answer"],
                        company=pending["company"],
                        role=pending["role"],
                        session_id=pending["session_id"],
                        original_answer=pending["original_answer"],
                    )

                await manager.send(session_id, {
                    "type": "fill:executed",
                    "payload": {
                        "requestId": request_id,
                        "fieldId": payload.get("fieldId"),
                        "success": success,
                        "reason": payload.get("reason"),
                    },
                })

            elif msg_type == "fill:reject":
                await manager.send(session_id, {
                    "type": "fill:rejected",
                    "payload": {"fieldId": payload.get("fieldId")},
                })

            elif msg_type == "fill:execute":
                # Static-autofill confirmation (profile:fills path). Relay
                # the content script's actual success value instead of
                # assuming success.
                await manager.send(session_id, {
                    "type": "fill:executed",
                    "payload": {
                        "selector": payload.get("selector"),
                        "value": payload.get("value"),
                        "success": bool(payload.get("success", True)),
                    },
                })

            elif msg_type == "answer:store":
                await save_answer(
                    question=payload.get("question", ""),
                    final_answer=payload.get("answer", ""),
                    company=payload.get("company", "") or (session.company or ""),
                    role=payload.get("role", "") or (session.role or ""),
                    session_id=session_id,
                )

            elif msg_type == "answer:edit":
                await save_answer(
                    question=payload.get("question", ""),
                    final_answer=payload.get("edited", ""),
                    company=payload.get("company", "") or (session.company or ""),
                    role=payload.get("role", "") or (session.role or ""),
                    session_id=session_id,
                    original_answer=payload.get("original"),
                )
                await manager.send(session_id, {
                    "type": "answer:saved",
                    "payload": {"question": payload.get("question", "")},
                })

            elif msg_type == "answer:approve":
                await save_answer(
                    question=payload.get("question", ""),
                    final_answer=payload.get("answer", ""),
                    company=payload.get("company", "") or (session.company or ""),
                    role=payload.get("role", "") or (session.role or ""),
                    session_id=session_id,
                )
                await manager.send(session_id, {
                    "type": "answer:saved",
                    "payload": {"question": payload.get("question", "")},
                })

            elif msg_type == "field:changed":
                pass

    except WebSocketDisconnect:
        manager.disconnect(session_id)
        session_manager.delete(session_id)
        _purge_pending_fills_for_session(session_id)
    except Exception as e:
        logger.error(f"WS error {session_id}: {e}", exc_info=True)
        manager.disconnect(session_id)
        session_manager.delete(session_id)
        _purge_pending_fills_for_session(session_id)
