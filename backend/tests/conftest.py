from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from backend.app.config import Settings


DEFAULT_TEST_DATABASE_URL = "postgresql+psycopg://reader:reader@localhost:5433/reader_test"
BACKEND_DIR = Path(__file__).resolve().parents[1]


def require_test_database_url(database_url: str) -> str:
    database_name = make_url(database_url).database

    if not database_name or not database_name.endswith("_test"):
        raise RuntimeError(
            "Integration database setup requires a database name ending in '_test'."
        )

    return database_url


def get_test_database_url() -> str:
    return require_test_database_url(
        os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
    )


@pytest.fixture(scope="session")
def migrated_database() -> Generator[Engine, None, None]:
    database_url = get_test_database_url()
    alembic_config = Config(str(BACKEND_DIR / "alembic.ini"))
    alembic_config.attributes["database_url"] = database_url
    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url, pool_pre_ping=True)

    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def db_session(migrated_database: Engine) -> Generator[Session, None, None]:
    connection = migrated_database.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()


@pytest.fixture
def app_settings() -> Settings:
    return Settings(
        openai_api_key=None,
        openai_model="gpt-5-mini",
        openai_reasoning_effort="minimal",
        cors_allow_origins=("*",),
        database_url=get_test_database_url(),
        oidc_issuer_url=None,
        oidc_audience=None,
        oidc_jwks_url=None,
        embedding_model="text-embedding-3-small",
        embedding_dimensions=1536,
        rag_vector_candidates=30,
        rag_keyword_candidates=30,
        rag_fused_candidates=8,
        rag_rrf_k=60,
        rag_min_vector_similarity=0.35,
        rag_context_max_chars=18_000,
        mindmap_extraction_model="gpt-4o-mini",
        mindmap_consolidation_model="gpt-4o",
        db_pool_size=3,
        db_max_overflow=2,
        sentry_dsn=None,
    )


@pytest.fixture
def test_app(app_settings: Settings) -> FastAPI:
    from backend.app.main import create_app

    return create_app(app_settings)


@pytest.fixture
def test_client(test_app: FastAPI) -> Generator[TestClient, None, None]:
    with TestClient(test_app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def committed_user(migrated_database) -> Generator:
    """Creates a real committed User row for API-level integration tests."""
    from sqlalchemy.orm import Session as OrmSession
    from backend.app.db.models import User

    user_id = None
    with OrmSession(migrated_database) as session:
        with session.begin():
            user = User()
            session.add(user)
            session.flush()
            user_id = user.id

    yield user_id

    with OrmSession(migrated_database) as session:
        with session.begin():
            user = session.get(User, user_id)
            if user:
                session.delete(user)


@pytest.fixture
def committed_other_user(migrated_database) -> Generator:
    """Creates a second real committed User row for ownership tests."""
    from sqlalchemy.orm import Session as OrmSession
    from backend.app.db.models import User

    user_id = None
    with OrmSession(migrated_database) as session:
        with session.begin():
            user = User()
            session.add(user)
            session.flush()
            user_id = user.id

    yield user_id

    with OrmSession(migrated_database) as session:
        with session.begin():
            user = session.get(User, user_id)
            if user:
                session.delete(user)


def _make_auth_client(app_settings: Settings, user_id) -> Generator[TestClient, None, None]:
    from backend.app.auth.dependencies import get_current_user
    from backend.app.db.models import User
    from backend.app.main import create_app

    dedicated_app = create_app(app_settings)
    fake_user = User()
    fake_user.id = user_id
    dedicated_app.dependency_overrides[get_current_user] = lambda: fake_user
    with TestClient(dedicated_app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def auth_client(app_settings: Settings, committed_user) -> Generator[TestClient, None, None]:
    yield from _make_auth_client(app_settings, committed_user)


@pytest.fixture
def other_auth_client(app_settings: Settings, committed_other_user) -> Generator[TestClient, None, None]:
    yield from _make_auth_client(app_settings, committed_other_user)
