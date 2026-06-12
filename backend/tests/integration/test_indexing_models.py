from __future__ import annotations

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.app.db.models import User
from backend.app.indexing.models import (
    Book,
    IndexJob,
    IndexVersion,
    IndexVersionStatus,
    JobStatus,
)


@pytest.fixture
def user(db_session: Session) -> User:
    u = User()
    db_session.add(u)
    db_session.flush()
    return u


@pytest.fixture
def book(db_session: Session, user: User) -> Book:
    b = Book(
        user_id=user.id,
        client_book_id="local-1",
        title="Test Book",
        author="Test Author",
        source_type="epub",
    )
    db_session.add(b)
    db_session.flush()
    return b


def test_deleting_book_cascades_private_index_content(db_session: Session, user: User) -> None:
    book = Book(
        user_id=user.id,
        client_book_id="local-1",
        title="Book",
        author="Author",
        source_type="epub",
    )
    db_session.add(book)
    db_session.flush()

    version = IndexVersion(
        book_id=book.id,
        content_hash="a" * 64,
        embedding_model="text-embedding-3-small",
        embedding_dimensions=1536,
        chunking_version="v1",
        expected_block_count=1,
        status=IndexVersionStatus.UPLOADING,
    )
    db_session.add(version)
    db_session.commit()

    db_session.delete(book)
    db_session.commit()

    assert db_session.get(IndexVersion, version.id) is None


def test_user_client_book_id_is_unique_per_user(db_session: Session, user: User) -> None:
    db_session.add(Book(user_id=user.id, client_book_id="dup", title="A", author="A", source_type="epub"))
    db_session.flush()

    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        db_session.add(Book(user_id=user.id, client_book_id="dup", title="B", author="B", source_type="epub"))
        db_session.flush()


def test_index_version_status_enum_values() -> None:
    assert IndexVersionStatus.UPLOADING == "uploading"
    assert IndexVersionStatus.QUEUED == "queued"
    assert IndexVersionStatus.INDEXING == "indexing"
    assert IndexVersionStatus.READY == "ready"
    assert IndexVersionStatus.FAILED == "failed"
    assert IndexVersionStatus.DELETING == "deleting"


def test_job_status_enum_values() -> None:
    assert JobStatus.QUEUED == "queued"
    assert JobStatus.RUNNING == "running"
    assert JobStatus.RETRY == "retry"
    assert JobStatus.COMPLETE == "complete"
    assert JobStatus.FAILED == "failed"


def test_index_job_belongs_to_version(db_session: Session, book: Book) -> None:
    version = IndexVersion(
        book_id=book.id,
        content_hash="b" * 64,
        embedding_model="text-embedding-3-small",
        embedding_dimensions=1536,
        chunking_version="v1",
        expected_block_count=1,
        status=IndexVersionStatus.QUEUED,
    )
    db_session.add(version)
    db_session.flush()

    job = IndexJob(
        index_version_id=version.id,
        status=JobStatus.QUEUED,
    )
    db_session.add(job)
    db_session.commit()

    assert job.id is not None
    assert job.index_version_id == version.id
    assert job.attempts == 0


def test_indexing_tables_exist(db_session: Session) -> None:
    inspector = inspect(db_session.bind)
    table_names = inspector.get_table_names()
    for expected in ("books", "index_versions", "book_blocks", "upload_batches", "rag_chunks", "index_jobs"):
        assert expected in table_names, f"Table {expected!r} is missing"


def test_hnsw_vector_index_exists(db_session: Session) -> None:
    row = db_session.execute(
        text("SELECT indexname FROM pg_indexes WHERE tablename = 'rag_chunks' AND indexname = 'ix_rag_chunks_embedding'")
    ).fetchone()
    assert row is not None, "HNSW vector index is missing"


def test_gin_search_vector_index_exists(db_session: Session) -> None:
    row = db_session.execute(
        text("SELECT indexname FROM pg_indexes WHERE tablename = 'rag_chunks' AND indexname = 'ix_rag_chunks_search_vector'")
    ).fetchone()
    assert row is not None, "GIN search_vector index is missing"
