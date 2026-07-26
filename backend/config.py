from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Snag"
    app_version: str = "0.2.0"
    host: str = "0.0.0.0"
    port: int = 8765

    embedding_model: str = "all-MiniLM-L6-v2"

    sqlite_path: str = "data/snag.db"

    ollama_url: str = "http://127.0.0.1:11434"

    log_level: str = "INFO"
    cors_origins: list[str] = ["*"]

    model_config = {"env_prefix": "SNAG_", "env_file": ".env"}


settings = Settings()
