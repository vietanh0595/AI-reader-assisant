from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


DEFAULT_OPENAI_MODEL = "gpt-5-mini"
DEFAULT_REASONING_EFFORT = "minimal"
BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent


@dataclass(frozen=True)
class Settings:
    openai_api_key: Optional[str]
    openai_model: str
    openai_reasoning_effort: Optional[str]
    cors_allow_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        load_project_env_files()

        return cls(
            openai_api_key=_read_optional_env("OPENAI_API_KEY"),
            openai_model=os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL).strip() or DEFAULT_OPENAI_MODEL,
            openai_reasoning_effort=_read_optional_env("OPENAI_REASONING_EFFORT") or DEFAULT_REASONING_EFFORT,
            cors_allow_origins=_read_cors_origins(),
        )

    def require_openai_api_key(self) -> str:
        if not self.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured.")

        return self.openai_api_key


def _read_optional_env(name: str) -> Optional[str]:
    value = os.getenv(name)

    if value is None:
        return None

    stripped_value = value.strip()
    return stripped_value or None


def _read_cors_origins() -> tuple[str, ...]:
    configured_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
    origins = tuple(origin.strip() for origin in configured_origins.split(",") if origin.strip())
    return origins or ("*",)


def load_project_env_files() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    load_dotenv(BACKEND_DIR / ".env", override=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()
