from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.app.indexing.jobs import JobRepository
from backend.app.indexing.models import Book, IndexJob, IndexVersion, IndexVersionStatus, JobStatus
from backend.tests.conftest import get_test_database_url


@pytest.fixture(scope="module")
def session_factory():
    engine = create_engine(get_test_database_url(), pool_pre_ping=True)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture
def committed_user_for_jobs(session_factory):
    from backend.app.db.models import User

    user_id = None
    with session_factory() as session:
        with session.begin():
            user = User()
            session.add(user)
            session.flush()
            user_id = user.id

    yield user_id

    with session_factory() as session:
        with session.begin():
            user = session.get(User, user_id)
            if user:
                session.delete(user)


@pytest.fixture
def queued_job(session_factory, committed_user_for_jobs):
    job_id = None
    version_id = None
    book_id = None

    with session_factory() as session:
        with session.begin():
            book = Book(
                user_id=committed_user_for_jobs,
                client_book_id="job-test-book",
                title="Test",
                author="Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()
            book_id = book.id

            version = IndexVersion(
                book_id=book_id,
                content_hash="b" * 64,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=1,
                status=IndexVersionStatus.QUEUED,
            )
            session.add(version)
            session.flush()
            version_id = version.id

            job = IndexJob(
                index_version_id=version_id,
                status=JobStatus.QUEUED,
                next_attempt_at=datetime.now(tz=timezone.utc) - timedelta(seconds=1),
            )
            session.add(job)
            session.flush()
            job_id = job.id

    yield type("FakeJob", (), {"id": job_id, "version_id": version_id, "book_id": book_id})()

    with session_factory() as session:
        with session.begin():
            book = session.get(Book, book_id)
            if book:
                session.delete(book)


def test_only_one_worker_claims_a_job(session_factory, queued_job):
    repo_a = JobRepository(session_factory)
    repo_b = JobRepository(session_factory)
    first = repo_a.claim("worker-a")
    second = repo_b.claim("worker-b")
    assert first is not None
    assert first.id == queued_job.id
    assert second is None


def test_expired_lease_can_be_reclaimed(session_factory, queued_job):
    with session_factory() as session:
        with session.begin():
            job = session.get(IndexJob, queued_job.id)
            job.status = JobStatus.RETRY
            job.lease_expires_at = datetime.now(tz=timezone.utc) - timedelta(seconds=1)
            job.next_attempt_at = datetime.now(tz=timezone.utc) - timedelta(seconds=1)

    repo = JobRepository(session_factory)
    claimed = repo.claim("worker-c")
    assert claimed is not None
    assert claimed.id == queued_job.id


def test_heartbeat_updates_timestamp(session_factory, queued_job):
    repo = JobRepository(session_factory)

    with session_factory() as session:
        with session.begin():
            job = session.get(IndexJob, queued_job.id)
            job.status = JobStatus.RUNNING
            job.lease_owner = "worker-hb"
            job.lease_expires_at = datetime.now(tz=timezone.utc) + timedelta(minutes=5)

    before = datetime.now(tz=timezone.utc)
    repo.heartbeat(queued_job.id, "worker-hb")

    with session_factory() as session:
        job = session.get(IndexJob, queued_job.id)
        assert job.heartbeat_at is not None
        assert job.heartbeat_at >= before
