from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session


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
