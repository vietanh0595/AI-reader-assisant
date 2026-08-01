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
    #
    # prepare_threshold=None disables psycopg3's automatic server-side prepared
    # statements. We connect through Supabase's Transaction-mode pooler (Supavisor),
    # which can hand out a different physical Postgres connection per transaction -
    # prepared statements live on the physical connection they were created on, so a
    # name psycopg3 reuses (e.g. "_pg3_0") can collide with another client's statement
    # of the same name on whichever physical connection the pooler happens to route to
    # next, raising psycopg.errors.DuplicatePreparedStatement. Supabase's own docs
    # recommend this exact setting for psycopg3 behind their pooler.
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=2,
        connect_args={"prepare_threshold": None},
    )
    return sessionmaker(bind=engine, expire_on_commit=False)


def session_dependency(factory: sessionmaker[Session]) -> SessionDependency:
    def get_session() -> Generator[Session, None, None]:
        with factory() as session:
            yield session

    return get_session
