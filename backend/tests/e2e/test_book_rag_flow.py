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
from typing import Any
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


def _content_hash_of(blocks: list[dict[str, Any]], source_type: str = "epub") -> str:
    """Replicate the client-side hashReaderBook algorithm."""
    block_hashes = []
    for block in sorted(blocks, key=lambda b: b["readingOrder"]):
        source_ref = block.get("sourceRef", {})
        canonical_ref = {k: source_ref[k] for k in sorted(source_ref) if source_ref[k] is not None}
        canonical = json.dumps(
            [
                block["paragraphId"],
                block["readingOrder"],
                block["blockKind"],
                block.get("chapterId"),
                block.get("chapterTitle"),
                canonical_ref,
                block["text"].strip(),
            ],
            separators=(",", ":"),
            ensure_ascii=False,
            sort_keys=True,
        )
        block_hashes.append(hashlib.sha256(canonical.encode()).hexdigest())
    book_input = f"1\n{source_type}\n" + "\n".join(block_hashes)
    return hashlib.sha256(book_input.encode()).hexdigest()


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


def _fake_agent(body: str = "Central banks set rates."):
    """Returns a BookAgent-like mock whose .answer() returns a canned BookAnswer."""
    agent = MagicMock()
    agent.answer.return_value = BookAnswer(
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
    return agent


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
            "contentHash": _content_hash_of(BOOK_BLOCKS),
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

    # Step 5: ask (first turn) — mock the agentic answerer
    first_question = "How do central banks control inflation?"
    fake_agent_first = _fake_agent("Central banks set rates to control inflation.")

    with patch("backend.app.routers.book_ask._build_agent", return_value=fake_agent_first):
        ask_resp = auth_client.post(
            f"/library/books/{cloud_book_id}/ask",
            json={
                "question": first_question,
                "currentParagraphId": "p1",
                "currentReadingOrder": 1,
                "includeWholeBook": True,
            },
        )

    assert ask_resp.status_code == 200
    first_answer = ask_resp.json()
    assert first_answer["supported"] is True
    first_body = first_answer["body"]
    assert len(first_body) > 0

    # Step 6: multi-turn ask — second question carries conversation history
    history_payload = [
        {"role": "user", "content": first_question},
        {"role": "assistant", "content": first_body},
    ]
    second_question = "What happens when rates are raised too fast?"
    captured_kwargs: dict = {}

    def _capturing_answer(**kwargs):
        captured_kwargs.update(kwargs)
        return BookAnswer(
            request_id=str(uuid.uuid4()),
            eyebrow="From the book",
            body="Rapid rate hikes can cause a recession.",
            supported=True,
            sources=[
                BookSource(
                    id="src-1",
                    paragraph_id="p2",
                    chapter_title="Chapter 1",
                    excerpt="Higher interest rates slow economic growth.",
                    page_index=None,
                    page_label=None,
                    source_ref={"source": "epub"},
                )
            ],
        )

    fake_agent_second = MagicMock()
    fake_agent_second.answer.side_effect = _capturing_answer

    with patch("backend.app.routers.book_ask._build_agent", return_value=fake_agent_second):
        ask_resp2 = auth_client.post(
            f"/library/books/{cloud_book_id}/ask",
            json={
                "question": second_question,
                "currentParagraphId": "p2",
                "currentReadingOrder": 2,
                "includeWholeBook": True,
                "history": history_payload,
            },
        )

    assert ask_resp2.status_code == 200
    second_answer = ask_resp2.json()
    assert len(second_answer["body"]) > 0

    # Assert sources have non-empty string IDs
    for source in second_answer["sources"]:
        assert isinstance(source["id"], str) and len(source["id"]) > 0

    # Assert the agent received the full conversation history
    assert "history" in captured_kwargs, "BookAgent.answer was not called with 'history'"
    forwarded_history = captured_kwargs["history"]
    assert len(forwarded_history) == 2, (
        f"Expected 2 history turns to be forwarded, got {len(forwarded_history)}"
    )
    assert forwarded_history[0]["role"] == "user"
    assert forwarded_history[0]["content"] == first_question
    assert forwarded_history[1]["role"] == "assistant"
    assert forwarded_history[1]["content"] == first_body


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
