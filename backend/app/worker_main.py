from __future__ import annotations

import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .config import get_settings
from .db.models import User  # noqa: F401 — registers 'users' table in shared MetaData
from .indexing.embeddings import OpenAIEmbeddingProvider
from .indexing.worker import IndexWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def build_worker(settings) -> IndexWorker:
    from openai import OpenAI

    # Pool size is env-var driven (DB_POOL_SIZE/DB_MAX_OVERFLOW, see config.py), shared
    # with the web service's own engine (db/session.py) against one Postgres instance.
    # The worker processes one job at a time plus a heartbeat thread, so it never needs
    # much - set a smaller override directly on this service's Render env vars if the
    # shared default ever gets raised for the web service's higher concurrency needs.
    #
    # prepare_threshold=None disables psycopg3's automatic server-side prepared
    # statements - required behind Supabase's Transaction-mode pooler, which can route
    # each transaction to a different physical Postgres connection. See db/session.py
    # for the full explanation; this worker hits it hardest since run_forever() repeats
    # the identical claim() query every couple of seconds, forever.
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        connect_args={"prepare_threshold": None},
    )
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    openai_client = OpenAI(api_key=settings.require_openai_api_key())
    embedding_provider = OpenAIEmbeddingProvider(
        openai_client,
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
    )
    return IndexWorker(session_factory=factory, embedding_provider=embedding_provider)


def main() -> None:
    worker = build_worker(get_settings())
    worker.run_forever(poll_seconds=2.0)


if __name__ == "__main__":
    main()
