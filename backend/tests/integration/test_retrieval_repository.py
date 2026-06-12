from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy.orm import sessionmaker

from backend.app.indexing.models import (
    Book,
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
