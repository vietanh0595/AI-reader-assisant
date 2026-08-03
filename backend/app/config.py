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
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIMENSIONS = 1536
DEFAULT_RAG_VECTOR_CANDIDATES = 30
DEFAULT_RAG_KEYWORD_CANDIDATES = 30
DEFAULT_RAG_FUSED_CANDIDATES = 8
DEFAULT_RAG_RRF_K = 60
DEFAULT_RAG_MIN_VECTOR_SIMILARITY = 0.20
DEFAULT_RAG_CONTEXT_MAX_CHARS = 18_000
DEFAULT_MINDMAP_EXTRACTION_MODEL = "gpt-4o-mini"
DEFAULT_MINDMAP_CONSOLIDATION_MODEL = "gpt-4o"
# Matches the web service's current pool (backend/app/db/session.py); the worker
# (worker_main.py) currently wants a smaller pool (2/1) and can override that via its
# own DB_POOL_SIZE/DB_MAX_OVERFLOW env vars on its Render service - these are just the
# fallback when neither is set.
DEFAULT_DB_POOL_SIZE = 3
DEFAULT_DB_MAX_OVERFLOW = 2
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
    embedding_model: str
    embedding_dimensions: int
    rag_vector_candidates: int
    rag_keyword_candidates: int
    rag_fused_candidates: int
    rag_rrf_k: int
    rag_min_vector_similarity: float
    rag_context_max_chars: int
    mindmap_extraction_model: str
    mindmap_consolidation_model: str
    db_pool_size: int
    db_max_overflow: int

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
            embedding_model=os.getenv("OPENAI_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL).strip() or DEFAULT_EMBEDDING_MODEL,
            embedding_dimensions=int(os.getenv("OPENAI_EMBEDDING_DIMENSIONS", str(DEFAULT_EMBEDDING_DIMENSIONS))),
            rag_vector_candidates=int(os.getenv("RAG_VECTOR_CANDIDATES", str(DEFAULT_RAG_VECTOR_CANDIDATES))),
            rag_keyword_candidates=int(os.getenv("RAG_KEYWORD_CANDIDATES", str(DEFAULT_RAG_KEYWORD_CANDIDATES))),
            rag_fused_candidates=int(os.getenv("RAG_FUSED_CANDIDATES", str(DEFAULT_RAG_FUSED_CANDIDATES))),
            rag_rrf_k=int(os.getenv("RAG_RRF_K", str(DEFAULT_RAG_RRF_K))),
            rag_min_vector_similarity=float(os.getenv("RAG_MIN_VECTOR_SIMILARITY", str(DEFAULT_RAG_MIN_VECTOR_SIMILARITY))),
            rag_context_max_chars=int(os.getenv("RAG_CONTEXT_MAX_CHARS", str(DEFAULT_RAG_CONTEXT_MAX_CHARS))),
            mindmap_extraction_model=os.getenv("MINDMAP_EXTRACTION_MODEL", DEFAULT_MINDMAP_EXTRACTION_MODEL).strip() or DEFAULT_MINDMAP_EXTRACTION_MODEL,
            mindmap_consolidation_model=os.getenv("MINDMAP_CONSOLIDATION_MODEL", DEFAULT_MINDMAP_CONSOLIDATION_MODEL).strip() or DEFAULT_MINDMAP_CONSOLIDATION_MODEL,
            db_pool_size=int(os.getenv("DB_POOL_SIZE", str(DEFAULT_DB_POOL_SIZE))),
            db_max_overflow=int(os.getenv("DB_MAX_OVERFLOW", str(DEFAULT_DB_MAX_OVERFLOW))),
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
