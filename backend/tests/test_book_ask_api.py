from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from backend.app.indexing.models import Book, IndexVersion, IndexVersionStatus, RagChunk
from backend.app.retrieval.schemas import BookAskRequest


def test_book_ask_request_accepts_history_and_selected_text():
    req = BookAskRequest.model_validate({
        "question": "what is the best strategy?",
        "currentParagraphId": "p-1",
        "currentReadingOrder": 53,
        "includeWholeBook": True,
        "history": [
            {"role": "user", "content": "what is a bond?"},
            {"role": "assistant", "content": "A bond is a loan to an issuer."},
        ],
        "selectedText": "callable bonds can be redeemed",
    })
    assert req.history[0].role == "user"
    assert req.selected_text == "callable bonds can be redeemed"


def test_book_ask_request_history_and_selection_default_empty():
    req = BookAskRequest.model_validate({
        "question": "hi",
        "currentParagraphId": "p-1",
        "currentReadingOrder": 0,
    })
    assert req.history == []
    assert req.selected_text is None
    assert req.allow_general_knowledge is False


def test_book_ask_request_accepts_allow_general_knowledge():
    req = BookAskRequest.model_validate({
        "question": "examples?",
        "currentParagraphId": "p-1",
        "currentReadingOrder": 0,
        "allowGeneralKnowledge": True,
    })
    assert req.allow_general_knowledge is True


def ask_request(
    question: str = "What changes borrowing costs?",
    current_paragraph_id: str = "p-40",
    current_reading_order: int = 40,
    current_chapter_id: str = "chapter-2",
    include_whole_book: bool = False,
) -> dict:
    return {
        "question": question,
        "currentParagraphId": current_paragraph_id,
        "currentReadingOrder": current_reading_order,
        "currentChapterId": current_chapter_id,
        "includeWholeBook": include_whole_book,
    }


def _create_ready_book(session_factory, user_id) -> tuple[UUID, UUID]:
    """Creates a book with a READY index version and some RAG chunks."""
    book_id = None
    version_id = None

    with session_factory() as session:
        with session.begin():
            book = Book(
                user_id=user_id,
                client_book_id="ask-test-book",
                title="Ask Test Book",
                author="Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()

            version = IndexVersion(
                book_id=book.id,
                content_hash="aa" * 32,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=1,
                status=IndexVersionStatus.READY,
            )
            session.add(version)
            session.flush()

            book.active_index_version_id = version.id

            chunk = RagChunk(
                index_version_id=version.id,
                chunk_order=0,
                chunk_hash="bb" * 32,
                raw_text="Monetary policy affects borrowing costs.",
                embedding_input_text="Monetary policy affects borrowing costs.",
                token_count=10,
                start_reading_order=30,
                end_reading_order=45,
                chapter_id="chapter-2",
                chapter_title="Chapter 2",
                paragraph_ids=["p-40"],
                source_refs=[{"source": "epub"}],
                embedding=[0.1] * 1536,
            )
            session.add(chunk)
            session.flush()
            from sqlalchemy import text
            session.execute(
                text("UPDATE rag_chunks SET search_vector = to_tsvector('english', embedding_input_text) "
                     "WHERE index_version_id = :vid"),
                {"vid": str(version.id)},
            )

            book_id = book.id
            version_id = version.id

    return book_id, version_id


def _delete_book(session_factory, book_id):
    with session_factory() as session:
        with session.begin():
            bk = session.get(Book, book_id)
            if bk:
                session.delete(bk)


def _fake_answerer(supported: bool = True, body: str = "Monetary policy raises rates."):
    """Patches BookAnswerer.answer to return a fake answer."""
    from backend.app.retrieval.models import BookAnswer, BookSource

    mock_answer = BookAnswer(
        request_id="test-request-id",
        eyebrow="Book answer",
        body=body,
        supported=supported,
        sources=[
            BookSource(
                id="source-0",
                paragraph_id="p-40",
                chapter_title="Chapter 2",
                excerpt="Monetary policy affects borrowing costs.",
                page_index=None,
                page_label=None,
                source_ref={"source": "epub"},
            )
        ] if supported else [],
    )
    return mock_answer


@pytest.fixture
def ready_book_fixture(migrated_database, committed_user):
    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)
    book_id, version_id = _create_ready_book(factory, committed_user)
    yield {"book_id": book_id, "factory": factory}
    _delete_book(factory, book_id)


def test_book_ask_returns_answer(auth_client, ready_book_fixture):
    book_id = ready_book_fixture["book_id"]

    mock_agent = MagicMock()
    mock_agent.answer.return_value = _fake_answerer(supported=True)

    with patch("backend.app.routers.book_ask._build_agent", return_value=mock_agent):
        response = auth_client.post(
            f"/library/books/{book_id}/ask",
            json=ask_request(),
        )
    assert response.status_code == 200
    data = response.json()
    assert data["supported"] is True


def test_book_ask_rejects_non_ready_index(auth_client, committed_user, migrated_database):
    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)

    with factory() as session:
        with session.begin():
            book = Book(
                user_id=committed_user,
                client_book_id="uploading-ask-book",
                title="Uploading Book",
                author="Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()

            version = IndexVersion(
                book_id=book.id,
                content_hash="cc" * 32,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=1,
                status=IndexVersionStatus.UPLOADING,
            )
            session.add(version)
            session.flush()
            book.active_index_version_id = version.id
            book_id = book.id

    response = auth_client.post(
        f"/library/books/{book_id}/ask",
        json=ask_request(),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["status"] == "uploading"

    _delete_book(factory, book_id)


def test_book_ask_rejects_unknown_book(auth_client):
    import uuid
    response = auth_client.post(
        f"/library/books/{uuid.uuid4()}/ask",
        json=ask_request(),
    )
    assert response.status_code == 404


@pytest.fixture
def ask_client_ready_book(app_settings, migrated_database, committed_user):
    """Yields (client, book_id, auth_headers) with a READY indexed book."""
    from backend.app.auth.dependencies import get_current_user
    from backend.app.db.models import User
    from backend.app.main import create_app

    factory = sessionmaker(bind=migrated_database, expire_on_commit=False)
    book_id, _ = _create_ready_book(factory, committed_user)

    dedicated_app = create_app(app_settings)
    fake_user = User()
    fake_user.id = committed_user
    dedicated_app.dependency_overrides[get_current_user] = lambda: fake_user

    with TestClient(dedicated_app, raise_server_exceptions=False) as client:
        yield client, book_id, {}

    _delete_book(factory, book_id)


def test_ask_uses_book_agent(monkeypatch, ask_client_ready_book):
    client, book_id, auth_headers = ask_client_ready_book
    captured = {}

    from backend.app.retrieval.models import BookAnswer, BookSource

    def fake_answer(self, **kwargs):
        captured.update(kwargs)
        return BookAnswer(
            request_id="r1", eyebrow="E", body="B", supported=True,
            sources=[BookSource(
                id="s0-0", paragraph_id="p-1", chapter_title="C",
                excerpt="ex", page_index=0, page_label=None,
                source_ref={"source": "epub"},
            )],
        )

    monkeypatch.setattr("backend.app.retrieval.agent.BookAgent.answer", fake_answer)

    resp = client.post(
        f"/library/books/{book_id}/ask",
        headers=auth_headers,
        json={
            "question": "best strategy?",
            "currentParagraphId": "p-1",
            "currentReadingOrder": 5,
            "includeWholeBook": True,
            "allowGeneralKnowledge": True,
            "history": [{"role": "user", "content": "earlier"}],
            "selectedText": "passage",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["body"] == "B"
    assert captured["history"] == [{"role": "user", "content": "earlier"}]
    assert captured["selected_text"] == "passage"
    assert captured["include_whole_book"] is True
    assert captured["allow_general_knowledge"] is True
