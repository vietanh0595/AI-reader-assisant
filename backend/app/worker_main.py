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

    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=5)
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
