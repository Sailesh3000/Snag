import logging

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import require_auth
from backend.feedback_service import FeedbackNotConfiguredError, FeedbackSendError, send_feedback_email

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/feedback", dependencies=[Depends(require_auth)])

ALLOWED_TYPES = {"general", "bug", "feature", "ux"}


@router.post("")
async def submit_feedback(body: dict):
    feedback_type = body.get("type", "general")
    if feedback_type not in ALLOWED_TYPES:
        feedback_type = "general"

    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "message is required")

    reporter_email = (body.get("email") or "").strip() or None
    source = body.get("source", "extension")
    version = body.get("version", "")

    try:
        send_feedback_email(feedback_type, message, reporter_email, source, version)
    except FeedbackNotConfiguredError as e:
        raise HTTPException(503, str(e))
    except FeedbackSendError as e:
        logger.error(f"Feedback send failed: {e}")
        raise HTTPException(502, str(e))

    return {"sent": True}
