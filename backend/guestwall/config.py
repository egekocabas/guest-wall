from functools import lru_cache
from pathlib import Path

from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    data_dir: Path = Path("/data")
    database_url: str | None = None
    printer_agent_url: str = "http://localhost:8001"
    printer_timeout_seconds: float = Field(default=30, gt=0, le=120)
    max_upload_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    preview_ttl_seconds: int = Field(default=60 * 60, ge=60)
    preview_cleanup_interval_seconds: int = Field(default=15 * 60, ge=10)
    public_host: str = "guest-wall.egekocabas.com"
    public_url: HttpUrl | None = None
    home_url: HttpUrl | None = None
    log_level: str = "INFO"

    @property
    def effective_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'guestwall.sqlite3').resolve()}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
