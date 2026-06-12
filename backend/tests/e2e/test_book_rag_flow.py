"""Acceptance test for the whole-book RAG pipeline.

Exercises the full path through real DB:
  create-or-resume → upload batch → commit → worker indexes → ask
without touching real OpenAI APIs (embedding + LLM are mocked).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import uuid
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import sessionmaker

from backend.app.indexing.models import Book, IndexJob, IndexVersion, IndexVersionStatus
from backend.app.indexing.worker import IndexWorker
from backend.app.retrieval.models import BookAnswer, BookSource


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BOOK_BLOCKS = [
    {
        "paragraphId": "p1",
        "readingOrder": 1,
        "chapterId": "ch1",
        "chapterTitle": "Chapter 1",
        "blockKind": "body",
        "text": "Central banks set interest rates to control inflation.",
        "sourceRef": {"source": "epub"},
    },
    {
        "paragraphId": "p2",
        "readingOrder": 2,
        "chapterId": "ch1",
        "chapterTitle": "Chapter 1",
        "blockKind": "body",
        "text": "Higher interest rates slow economic growth.",
        "sourceRef": {"source": "epub"},
    },
    {
        "paragraphId": "p3",
        "readingOrder": 3,
        "chapterId": "ch1",
        "chapterTitle": "Chapter 1",
        "blockKind": "body",
        "text": "Inflation targeting helps maintain price stability.",
        "sourceRef": {"source": "epub"},
    },
]


def _gzip_blocks(blocks: list[dict]) -> bytes:
    return gzip.compress(json.dumps({"blocks": blocks}).encode())


def _fake_embedder(dimensions: int = 1536):
    """Returns an embedding provider that yields deterministic dummy vectors."""
    embedder = MagicMock()
    embedder.embed_documents.side_effect = lambda texts: [
        [float(i) / max(1, len(texts)) * 0.1] * dimensions for i in range(len(texts))
    ]
    return embedder


def _fake_answerer(body: str = "Central banks set rates."):
    answerer = MagicMock()
    answerer.answer.return_value = BookAnswer(
        request_id=str(uuid.uuid4()),
        eyebrow="From the book",
        body=body,
        supported=True,
        sources=[
            BookSource(
                id="src-0",
                paragraph_id="p1",
                chapter_title="Chapter 1",
                excerpt="Central banks set interest rates.",
                page_index=None,
                page_label=None,
                source_ref={"source": "epub"},
            )
        ],
    )
    return answerer


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def book_fixture(migrated_database, committed_user):
    """Yields a committed Book row and tears it down after the test."""
    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)
    book_id = None

    with factory() as session:
        with session.begin():
            book = Book(
                user_id=committed_user,
                client_book_id="e2e-test-book",
                title="E2E Test Book",
                author="Test Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()
            book_id = book.id

    yield {"book_id": book_id, "factory": factory}

    with factory() as session:
        with session.begin():
            bk = session.get(Book, book_id)
            if bk:
                session.delete(bk)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_create_or_resume_returns_book_id(auth_client, book_fixture):
    """create-or-resume should return a stable bookId and versionId."""
    response = auth_client.post(
        "/library/books/index",
        json={
            "clientBookId": "e2e-test-book",
            "title": "E2E Test Book",
            "author": "Test Author",
            "sourceType": "epub",
            "contentHash": "aa" * 32,
            "blockCount": len(BOOK_BLOCKS),
            "parserSchemaVersion": 1,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "bookId" in data
    assert "versionId" in data
    assert data["reused"] is False


def test_full_indexing_pipeline(auth_client, book_fixture, migrated_database, app_settings):
    """
    Full flow:
      1. create-or-resume
      2. upload batch
      3. commit
      4. worker processes the job (mocked embedder)
      5. ask returns a grounded answer (mocked answerer)
    """
    book_id = book_fixture["book_id"]
    factory = book_fixture["factory"]

    # Step 1: create-or-resume
    resp = auth_client.post(
        "/library/books/index",
        json={
            "clientBookId": "e2e-test-book",
            "title": "E2E Test Book",
            "author": "Test Author",
            "sourceType": "epub",
            "contentHash": "bb" * 32,
            "blockCount": len(BOOK_BLOCKS),
            "parserSchemaVersion": 1,
        },
    )
    assert resp.status_code == 200
    index_data = resp.json()
    version_id = index_data["versionId"]
    cloud_book_id = index_data["bookId"]

    # Step 2: upload batch
    compressed = _gzip_blocks(BOOK_BLOCKS)
    upload_resp = auth_client.put(
        f"/library/books/{cloud_book_id}/index/versions/{version_id}/batches/0",
        content=compressed,
        headers={
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
            "Idempotency-Key": "e2e-batch-0",
            "X-Payload-SHA256": hashlib.sha256(compressed).hexdigest(),
        },
    )
    assert upload_resp.status_code == 200

    # Step 3: commit
    commit_resp = auth_client.post(
        f"/library/books/{cloud_book_id}/index/versions/{version_id}/commit",
    )
    assert commit_resp.status_code == 200

    # Step 4: run worker with mocked embedder
    with factory() as session:
        with session.begin():
            job = session.query(IndexJob).filter_by(index_version_id=uuid.UUID(version_id)).first()
            assert job is not None, "Worker job was not enqueued after commit"

    fake_embedder = _fake_embedder(dimensions=app_settings.embedding_dimensions)
    worker = IndexWorker(
        session_factory=factory,
        embedding_provider=fake_embedder,
    )
    worker_id = "e2e-test-worker"
    job = worker._jobs.claim(worker_id)
    assert job is not None, "No job available to claim"
    worker.process(job)

    # Verify version is now READY
    with factory() as session:
        version = session.get(IndexVersion, uuid.UUID(version_id))
        assert version is not None
        assert version.status == IndexVersionStatus.READY

    # Step 5: ask - mock both retrieval service and answerer
    mock_evidence = MagicMock()
    mock_evidence.supported = True
    mock_service = MagicMock()
    mock_service.retrieve.return_value = mock_evidence

    with patch("backend.app.routers.book_ask._build_retrieval_service", return_value=mock_service), \
         patch("backend.app.routers.book_ask._build_answerer", return_value=_fake_answerer()):
        ask_resp = auth_client.post(
            f"/library/books/{cloud_book_id}/ask",
            json={
                "question": "How do central banks control inflation?",
                "currentParagraphId": "p1",
                "currentReadingOrder": 1,
                "includeWholeBook": True,
            },
        )

    assert ask_resp.status_code == 200
    answer = ask_resp.json()
    assert answer["supported"] is True
    assert len(answer["body"]) > 0


def test_resume_reuses_existing_version(auth_client, book_fixture):
    """A second create-or-resume with the same hash returns reused=True."""
    content_hash = "cc" * 32

    resp1 = auth_client.post(
        "/library/books/index",
        json={
            "clientBookId": "e2e-test-book",
            "title": "E2E Test Book",
            "author": "Test Author",
            "sourceType": "epub",
            "contentHash": content_hash,
            "blockCount": 3,
            "parserSchemaVersion": 1,
        },
    )
    assert resp1.status_code == 200

    resp2 = auth_client.post(
        "/library/books/index",
        json={
            "clientBookId": "e2e-test-book",
            "title": "E2E Test Book",
            "author": "Test Author",
            "sourceType": "epub",
            "contentHash": content_hash,
            "blockCount": 3,
            "parserSchemaVersion": 1,
        },
    )
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["versionId"] == resp1.json()["versionId"]
