from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


DEFAULT_OPENAI_MODEL = "gpt-5-mini"
DEFAULT_REASONING_EFFORT = "minimal"
DEFAULT_DATABASE_URL = "postgresql+psycopg://reader:reader@localhost:5432/reader"
BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent


@dataclass(frozen=True)
class OidcSettings:
    issuer_url: str
    audience: str
    jwks_url: str


@dataclass(frozen=True)
class Settings:
    openai_api_key: Optional[str]
    openai_model: str
    openai_reasoning_effort: Optional[str]
    cors_allow_origins: tuple[str, ...]
    database_url: str
    oidc_issuer_url: Optional[str]
    oidc_audience: Optional[str]
    oidc_jwks_url: Optional[str]

    @classmethod
    def from_env(cls) -> "Settings":
        load_project_env_files()

        return cls(
            openai_api_key=_read_optional_env("OPENAI_API_KEY"),
            openai_model=os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL).strip() or DEFAULT_OPENAI_MODEL,
            openai_reasoning_effort=_read_optional_env("OPENAI_REASONING_EFFORT") or DEFAULT_REASONING_EFFORT,
            cors_allow_origins=_read_cors_origins(),
            database_url=_read_optional_env("DATABASE_URL") or DEFAULT_DATABASE_URL,
            oidc_issuer_url=_read_optional_env("OIDC_ISSUER_URL"),
            oidc_audience=_read_optional_env("OIDC_AUDIENCE"),
            oidc_jwks_url=_read_optional_env("OIDC_JWKS_URL"),
        )

    def require_openai_api_key(self) -> str:
        if not self.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured.")

        return self.openai_api_key

    def require_oidc_settings(self) -> OidcSettings:
        issuer_url = self.oidc_issuer_url
        audience = self.oidc_audience
        jwks_url = self.oidc_jwks_url
        configured_values = {
            "OIDC_ISSUER_URL": issuer_url,
            "OIDC_AUDIENCE": audience,
            "OIDC_JWKS_URL": jwks_url,
        }
        missing_names = [name for name, value in configured_values.items() if not value]

        if missing_names:
            raise RuntimeError(f"Missing required OIDC settings: {', '.join(missing_names)}")

        assert issuer_url is not None
        assert audience is not None
        assert jwks_url is not None

        return OidcSettings(
            issuer_url=issuer_url,
            audience=audience,
            jwks_url=jwks_url,
        )


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
