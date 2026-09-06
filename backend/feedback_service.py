"""Send Sidebar feedback submissions to the maintainer's inbox over SMTP.

Deliberately simple: stdlib smtplib only, no new dependency, no queue/retry —
feedback is low-volume and the caller (feedback_routes.py) reports send
failure back to the user rather than silently swallowing it.
"""
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

from backend.config import settings


class FeedbackNotConfiguredError(Exception):
    """Raised when smtp_username/smtp_password haven't been set (.env)."""


class FeedbackSendError(Exception):
    """Raised when the SMTP send itself fails (bad credentials, network, ...)."""


def is_configured() -> bool:
    return bool(settings.smtp_username and settings.smtp_password)


def send_feedback_email(
    feedback_type: str,
    message: str,
    reporter_email: str | None,
    source: str,
    version: str,
) -> None:
    if not is_configured():
        raise FeedbackNotConfiguredError(
            "Feedback email isn't configured on this backend yet "
            "(SNAG_SMTP_USERNAME / SNAG_SMTP_PASSWORD missing)."
        )

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    email_msg = EmailMessage()
    email_msg["Subject"] = f"[Snag Feedback] {feedback_type}"
    email_msg["From"] = settings.smtp_username
    email_msg["To"] = settings.feedback_to_email
    if reporter_email:
        email_msg["Reply-To"] = reporter_email

    body_lines = [
        f"Type: {feedback_type}",
        f"Source: {source}",
        f"Version: {version}",
        f"Reporter email: {reporter_email or '(not provided)'}",
        f"Received: {timestamp}",
        "",
        "Message:",
        message,
    ]
    email_msg.set_content("\n".join(body_lines))

    try:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(email_msg)
    except (smtplib.SMTPException, OSError) as e:
        raise FeedbackSendError(f"Couldn't send feedback email: {e}") from e
