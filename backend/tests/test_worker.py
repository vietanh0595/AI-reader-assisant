from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from backend.app.indexing.chunker import StructureAwareChunker
from backend.app.indexing.embeddings import OpenAIEmbeddingProvider
from backend.app.indexing.worker import IndexWorker


def _make_block(i: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=f"block-{i}",
        paragraph_id=f"para-{i}",
        reading_order=i,
        block_kind="body",
        text=f"Block {i} content.",
        text_hash="",
        chapter_id="ch1",
        chapter_title="Chapter 1",
        source_ref={"source": "epub"},
    )


def _fake_embedding_provider(dimension: int = 4) -> MagicMock:
    provider = MagicMock(spec=OpenAIEmbeddingProvider)

    def embed_docs(texts):
        return [[0.1 * i for i in range(dimension)] for _ in texts]

    provider.embed_documents.side_effect = embed_docs
    return provider


def test_worker_processes_job_end_to_end(migrated_database, committed_user):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy.orm import Session, sessionmaker
    from backend.app.db.models import User
    from backend.app.indexing.models import (
        Book, IndexVersion, IndexVersionStatus, IndexJob, JobStatus, BookBlock
    )

    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)

    # Create book, version (QUEUED), blocks, and job
    with factory() as session:
        with session.begin():
            book = Book(
                user_id=committed_user,
                client_book_id="worker-test-book",
                title="Worker Test",
                author="Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()

            version = IndexVersion(
                book_id=book.id,
                content_hash="c" * 64,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=5,
                status=IndexVersionStatus.QUEUED,
            )
            session.add(version)
            session.flush()

            for i in range(5):
                blk = BookBlock(
                    index_version_id=version.id,
                    paragraph_id=f"p{i}",
                    reading_order=i,
                    block_kind="body",
                    text=f"Block {i} text content for testing.",
                    text_hash="x" * 64,
                    source_ref={"source": "epub"},
                )
                session.add(blk)

            job = IndexJob(
                index_version_id=version.id,
                status=JobStatus.QUEUED,
                next_attempt_at=datetime.now(tz=timezone.utc),
            )
            session.add(job)
            session.flush()

            book_id = book.id
            version_id = version.id
            job_id = job.id

    provider = _fake_embedding_provider(dimension=1536)
    worker = IndexWorker(session_factory=factory, embedding_provider=provider)

    job_ns = SimpleNamespace(id=job_id, index_version_id=version_id)
    worker.process(job_ns)

    with factory() as session:
        ver = session.get(IndexVersion, version_id)
        bk = session.get(Book, book_id)
        assert ver.status == IndexVersionStatus.READY
        assert bk.active_index_version_id == version_id

    # cleanup
    with factory() as session:
        with session.begin():
            bk = session.get(Book, book_id)
            if bk:
                session.delete(bk)


def test_failed_rebuild_keeps_previous_active_version(migrated_database, committed_user):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy.orm import sessionmaker
    from backend.app.indexing.models import (
        Book, IndexVersion, IndexVersionStatus, IndexJob, JobStatus, BookBlock
    )

    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)

    with factory() as session:
        with session.begin():
            book = Book(
                user_id=committed_user,
                client_book_id="worker-fail-book",
                title="Fail Test",
                author="Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()

            ready_version = IndexVersion(
                book_id=book.id,
                content_hash="d" * 64,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=1,
                status=IndexVersionStatus.READY,
            )
            session.add(ready_version)
            session.flush()

            book.active_index_version_id = ready_version.id

            pending_version = IndexVersion(
                book_id=book.id,
                content_hash="e" * 64,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=3,
                status=IndexVersionStatus.QUEUED,
            )
            session.add(pending_version)
            session.flush()

            for i in range(3):
                blk = BookBlock(
                    index_version_id=pending_version.id,
                    paragraph_id=f"p{i}",
                    reading_order=i,
                    block_kind="body",
                    text=f"Block {i}.",
                    text_hash="y" * 64,
                    source_ref={"source": "epub"},
                )
                session.add(blk)

            job = IndexJob(
                index_version_id=pending_version.id,
                status=JobStatus.QUEUED,
                next_attempt_at=datetime.now(tz=timezone.utc),
            )
            session.add(job)
            session.flush()

            book_id = book.id
            ready_version_id = ready_version.id
            pending_version_id = pending_version.id
            job_id = job.id

    failing_provider = MagicMock(spec=OpenAIEmbeddingProvider)
    failing_provider.embed_documents.side_effect = RuntimeError("embedding API failure")

    worker = IndexWorker(session_factory=factory, embedding_provider=failing_provider)
    job_ns = SimpleNamespace(id=job_id, index_version_id=pending_version_id)

    try:
        worker.process(job_ns)
    except Exception:
        pass

    with factory() as session:
        bk = session.get(Book, book_id)
        pv = session.get(IndexVersion, pending_version_id)
        assert bk.active_index_version_id == ready_version_id
        assert pv.status == IndexVersionStatus.FAILED

    # cleanup
    with factory() as session:
        with session.begin():
            bk = session.get(Book, book_id)
            if bk:
                session.delete(bk)
