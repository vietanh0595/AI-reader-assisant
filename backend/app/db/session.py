from __future__ import annotations

from collections.abc import Callable, Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from ..config import Settings


SessionDependency = Callable[[], Generator[Session, None, None]]


def create_session_factory(settings: Settings) -> sessionmaker[Session]:
    # Explicit, modest pool size: this engine shares a connection budget with the
    # worker's own engine (worker_main.py) against one Postgres instance, so we don't
    # want SQLAlchemy's defaults (5 + 10 overflow = 15) unconstrained on both sides.
    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=3, max_overflow=2)
    return sessionmaker(bind=engine, expire_on_commit=False)


def session_dependency(factory: sessionmaker[Session]) -> SessionDependency:
    def get_session() -> Generator[Session, None, None]:
        with factory() as session:
            yield session

    return get_session
