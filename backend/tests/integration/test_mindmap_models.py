from __future__ import annotations
import pytest
from uuid import uuid4
from sqlalchemy.orm import Session
from backend.app.mindmap.models import MindMap, MindMapStatus
from backend.app.mindmap.repository import MindMapRepository
from backend.app.indexing.models import Book
from backend.app.db.models import User


@pytest.fixture
def user_and_book(db_session: Session):
    user = User()
    db_session.add(user)
    db_session.flush()
    book = Book(
        user_id=user.id,
        client_book_id="mm-test-book",
        title="Test Book",
        author="Author",
        source_type="epub",
    )
    db_session.add(book)
    db_session.flush()
    return user.id, book.id


def test_upsert_creates_new_row(db_session, user_and_book):
    _, book_id = user_and_book
    repo = MindMapRepository(db_session)
    mindmap = repo.upsert(book_id, MindMapStatus.GENERATING)
    assert mindmap.book_id == book_id
    assert mindmap.status == MindMapStatus.GENERATING
    assert mindmap.data is None


def test_upsert_overwrites_existing(db_session, user_and_book):
    _, book_id = user_and_book
    repo = MindMapRepository(db_session)
    repo.upsert(book_id, MindMapStatus.GENERATING)
    db_session.flush()
    repo.upsert(book_id, MindMapStatus.READY, data={"genre": "fiction", "nodes": [], "edges": []})
    result = repo.get(book_id)
    assert result is not None
    assert result.status == MindMapStatus.READY
    assert result.data["genre"] == "fiction"


def test_get_returns_none_when_missing(db_session, user_and_book):
    _, book_id = user_and_book
    repo = MindMapRepository(db_session)
    assert repo.get(book_id) is None


def test_set_failed(db_session, user_and_book):
    _, book_id = user_and_book
    repo = MindMapRepository(db_session)
    repo.upsert(book_id, MindMapStatus.GENERATING)
    db_session.flush()
    repo.set_failed(book_id, "openai_error: timeout")
    result = repo.get(book_id)
    assert result.status == MindMapStatus.FAILED
    assert result.error == "openai_error: timeout"
