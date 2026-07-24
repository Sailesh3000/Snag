from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "ApplyPilot"
    app_version: str = "0.2.0"
    host: str = "127.0.0.1"
    port: int = 8765

    embedding_model: str = "all-MiniLM-L6-v2"

    sqlite_path: str = "data/applypilot.db"

    log_level: str = "INFO"
    cors_origins: list[str] = ["*"]

    model_config = {"env_prefix": "APPLYPILOT_", "env_file": ".env"}


settings = Settings()
