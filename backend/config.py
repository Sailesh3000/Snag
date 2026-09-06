import secrets
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Snag"
    app_version: str = "0.2.0"
    # Local-only by default: Snag has no user accounts, so anything reachable
    # over the network is reachable by whoever's on it. Binding to loopback
    # means only processes on this machine (the browser, the extension) can
    # even open a connection — see auth_token below for the second layer that
    # stops OTHER pages/processes on this same machine from using it.
    host: str = "127.0.0.1"
    port: int = 8765

    embedding_model: str = "all-MiniLM-L6-v2"

    sqlite_path: str = "data/snag.db"
    resume_upload_dir: str = "data/resumes"

    ollama_url: str = "http://127.0.0.1:11434"

    log_level: str = "INFO"
    # CORS is intentionally left permissive — it is NOT the security boundary
    # here (see auth_token). A browser extension page calling a local backend
    # sends a chrome-extension://<random-per-install-id> Origin that can't be
    # allowlisted in advance, so origin-based CORS can't do real access
    # control for this architecture. The auth token is what actually decides
    # whether a request is trusted.
    cors_origins: list[str] = ["*"]

    # Per-installation shared secret the extension must present (as
    # `Authorization: Bearer <token>` on REST calls, `?token=` on the
    # WebSocket) for any request that touches profile/memory data. Generated
    # once and persisted to auth_token_path if not set via SNAG_AUTH_TOKEN.
    auth_token: str = ""
    auth_token_path: str = "data/auth_token.txt"

    model_config = {"env_prefix": "SNAG_", "env_file": ".env"}


settings = Settings()


def _ensure_auth_token() -> str:
    if settings.auth_token:
        return settings.auth_token

    token_path = Path(settings.auth_token_path)
    token_path.parent.mkdir(parents=True, exist_ok=True)

    if token_path.exists():
        existing = token_path.read_text(encoding="utf-8").strip()
        if existing:
            return existing

    token = secrets.token_urlsafe(32)
    token_path.write_text(token, encoding="utf-8")
    try:
        token_path.chmod(0o600)
    except (OSError, NotImplementedError):
        pass  # best-effort on platforms/filesystems that don't support POSIX perms (e.g. some Windows setups)
    return token


settings.auth_token = _ensure_auth_token()
