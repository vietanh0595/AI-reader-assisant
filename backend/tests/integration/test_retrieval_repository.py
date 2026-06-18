from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import sessionmaker

from backend.app.indexing.models import (
    Book,
    BookBlock,
    IndexVersion,
    IndexVersionStatus,
    RagChunk,
)
from backend.app.retrieval.repository import RetrievalRepository
from backend.tests.conftest import get_test_database_url


@pytest.fixture(scope="module")
def sf(migrated_database):
    return sessionmaker(bind=migrated_database, expire_on_commit=False)


@pytest.fixture
def retrieval_fixture(sf, committed_user):
    """Creates a book with 5 RAG chunks and an active ready index version."""
    chunks_ids = []
    book_id = None

    with sf() as session:
        with session.begin():
            book = Book(
                user_id=committed_user,
                client_book_id="retrieval-test-book",
                title="Economics Book",
                author="Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()

            version = IndexVersion(
                book_id=book.id,
                content_hash="f" * 64,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=5,
                status=IndexVersionStatus.READY,
            )
            session.add(version)
            session.flush()

            book.active_index_version_id = version.id

            texts = [
                "Monetary policy affects borrowing costs and economic activity.",
                "Central banks use interest rates to control inflation.",
                "Fiscal policy involves government spending and taxation.",
                "The money supply is managed through open market operations.",
                "Chapter 3 discusses deflation risks and countermeasures.",
            ]
            embedding_base = [0.1] * 1536

            for i, text in enumerate(texts):
                # Make each embedding slightly different
                vec = embedding_base[:]
                vec[i] = 0.9
                chunk = RagChunk(
                    index_version_id=version.id,
                    chunk_order=i,
                    chunk_hash="g" * 64,
                    raw_text=text,
                    embedding_input_text=text,
                    token_count=20,
                    start_reading_order=i * 10,
                    end_reading_order=i * 10 + 9,
                    chapter_id=f"chapter-{i // 2 + 1}",
                    chapter_title=f"Chapter {i // 2 + 1}",
                    paragraph_ids=[f"p{i}"],
                    source_refs=[{"source": "epub"}],
                    embedding=vec,
                )
                session.add(chunk)
                session.flush()
                chunks_ids.append(chunk.id)

            book_id = book.id
            version_id = version.id

            session.flush()
            from sqlalchemy import text as sqlt
            session.execute(
                sqlt("UPDATE rag_chunks SET search_vector = to_tsvector('english', embedding_input_text) "
                     "WHERE index_version_id = :vid"),
                {"vid": str(version_id)},
            )

    yield {
        "book_id": book_id,
        "version_id": version_id,
        "user_id": committed_user,
        "chunk_ids": chunks_ids,
    }

    with sf() as session:
        with session.begin():
            bk = session.get(Book, book_id)
            if bk:
                session.delete(bk)


def test_vector_search_returns_results(sf, retrieval_fixture):
    repo = RetrievalRepository(sf)
    query_embedding = [0.1] * 1536
    query_embedding[0] = 0.9

    results = repo.vector_search(
        user_id=retrieval_fixture["user_id"],
        book_id=retrieval_fixture["book_id"],
        query_embedding=query_embedding,
        limit=5,
    )
    assert len(results) >= 1
    assert all(r.chunk_id in retrieval_fixture["chunk_ids"] for r in results)


def test_vector_search_respects_reading_order(sf, retrieval_fixture):
    repo = RetrievalRepository(sf)
    query_embedding = [0.1] * 1536

    results = repo.vector_search(
        user_id=retrieval_fixture["user_id"],
        book_id=retrieval_fixture["book_id"],
        query_embedding=query_embedding,
        limit=10,
        max_reading_order=15,
    )
    assert all(r.start_reading_order <= 15 for r in results)


def test_keyword_search_returns_results(sf, retrieval_fixture):
    repo = RetrievalRepository(sf)
    results = repo.keyword_search(
        user_id=retrieval_fixture["user_id"],
        book_id=retrieval_fixture["book_id"],
        query="monetary policy",
        limit=5,
    )
    assert len(results) >= 1


def test_keyword_search_scope_excludes_other_version(sf, committed_user):
    """Chunks from non-active versions should not appear."""
    repo = RetrievalRepository(sf)

    with sf() as session:
        with session.begin():
            book = Book(
                user_id=committed_user,
                client_book_id="other-version-book",
                title="Scoped",
                author="Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()

            inactive = IndexVersion(
                book_id=book.id,
                content_hash="h" * 64,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=1,
                status=IndexVersionStatus.READY,
            )
            session.add(inactive)
            session.flush()

            chunk = RagChunk(
                index_version_id=inactive.id,
                chunk_order=0,
                chunk_hash="i" * 64,
                raw_text="Unique phrase xyz789 in inactive version",
                embedding_input_text="Unique phrase xyz789 in inactive version",
                token_count=5,
                start_reading_order=0,
                end_reading_order=0,
                paragraph_ids=[],
                source_refs=[],
                embedding=[0.5] * 1536,
            )
            session.add(chunk)
            session.flush()
            book_id = book.id

    results = repo.keyword_search(
        user_id=committed_user,
        book_id=book_id,
        query="xyz789",
        limit=5,
    )
    # active_index_version_id is None, so no chunks should be visible
    assert len(results) == 0

    with sf() as session:
        with session.begin():
            bk = session.get(Book, book_id)
            if bk:
                session.delete(bk)


@pytest.fixture
def seeded_book_with_blocks(sf, committed_user):
    """Creates a book with 21 BookBlock rows (reading_order 0..20) and an active READY index version."""
    book_id = None

    with sf() as session:
        with session.begin():
            book = Book(
                user_id=committed_user,
                client_book_id="context-window-test-book",
                title="Context Window Book",
                author="Author",
                source_type="epub",
            )
            session.add(book)
            session.flush()

            version = IndexVersion(
                book_id=book.id,
                content_hash="a" * 64,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
                chunking_version="v1",
                expected_block_count=21,
                status=IndexVersionStatus.READY,
            )
            session.add(version)
            session.flush()

            book.active_index_version_id = version.id

            for i in range(21):
                block = BookBlock(
                    index_version_id=version.id,
                    paragraph_id=f"para-{i}",
                    reading_order=i,
                    block_kind="paragraph",
                    text=f"para {i}",
                    text_hash="b" * 64,
                    chapter_title="Chapter 1",
                    source_ref={},
                )
                session.add(block)

            book_id = book.id

    yield (RetrievalRepository(sf), committed_user, book_id)

    with sf() as session:
        with session.begin():
            bk = session.get(Book, book_id)
            if bk:
                session.delete(bk)


def test_read_context_window_returns_blocks_around_position(seeded_book_with_blocks):
    repo, user_id, book_id = seeded_book_with_blocks  # blocks at reading_order 0..20
    rows = repo.read_context_window(
        user_id=user_id, book_id=book_id, center_reading_order=10, radius=2,
    )
    orders = [r.reading_order for r in rows]
    assert orders == [8, 9, 10, 11, 12]


def test_read_context_window_clamps_at_start(seeded_book_with_blocks):
    repo, user_id, book_id = seeded_book_with_blocks
    rows = repo.read_context_window(
        user_id=user_id, book_id=book_id, center_reading_order=1, radius=3,
    )
    assert [r.reading_order for r in rows] == [0, 1, 2, 3, 4]


def test_read_context_window_clamps_at_end(seeded_book_with_blocks):
    repo, user_id, book_id = seeded_book_with_blocks
    rows = repo.read_context_window(
        user_id=user_id, book_id=book_id, center_reading_order=19, radius=3,
    )
    assert [r.reading_order for r in rows] == [16, 17, 18, 19, 20]


def test_read_context_window_excludes_other_users_book(seeded_book_with_blocks):
    repo, _owner_user_id, book_id = seeded_book_with_blocks
    other_user_id = uuid4()
    rows = repo.read_context_window(
        user_id=other_user_id, book_id=book_id, center_reading_order=10, radius=2,
    )
    assert rows == []
