from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from .models import RetrievalCandidate


class RetrievalRepository:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._factory = session_factory

    def vector_search(
        self,
        user_id: UUID,
        book_id: UUID,
        query_embedding: list[float],
        limit: int = 30,
        max_reading_order: Optional[int] = None,
    ) -> list[RetrievalCandidate]:
        reading_order_filter = ""
        if max_reading_order is not None:
            reading_order_filter = """
                AND rc.start_reading_order <= :max_reading_order
                AND rc.end_reading_order <= :max_reading_order
            """

        sql = text(f"""
            SELECT
                rc.id,
                rc.chunk_order,
                rc.raw_text,
                rc.start_reading_order,
                rc.end_reading_order,
                rc.chapter_id,
                rc.chapter_title,
                rc.page_start,
                rc.page_end,
                rc.paragraph_ids,
                rc.source_refs,
                1 - (rc.embedding <=> CAST(:query_embedding AS vector)) AS vector_similarity
            FROM rag_chunks rc
            JOIN index_versions iv ON iv.id = rc.index_version_id
            JOIN books b ON b.active_index_version_id = iv.id
            WHERE b.id = :book_id
              AND b.user_id = :user_id
              {reading_order_filter}
            ORDER BY rc.embedding <=> CAST(:query_embedding AS vector)
            LIMIT :limit
        """)

        embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

        params = {
            "book_id": str(book_id),
            "user_id": str(user_id),
            "query_embedding": embedding_str,
            "limit": limit,
        }
        if max_reading_order is not None:
            params["max_reading_order"] = max_reading_order

        with self._factory() as session:
            rows = session.execute(sql, params).fetchall()

        return [
            RetrievalCandidate(
                chunk_id=row[0],
                chunk_order=row[1],
                raw_text=row[2],
                start_reading_order=row[3],
                end_reading_order=row[4],
                chapter_id=row[5],
                chapter_title=row[6],
                page_start=row[7],
                page_end=row[8],
                paragraph_ids=row[9] or [],
                source_refs=row[10] or [],
                vector_similarity=float(row[11]) if row[11] is not None else None,
            )
            for row in rows
        ]

    def keyword_search(
        self,
        user_id: UUID,
        book_id: UUID,
        query: str,
        limit: int = 30,
        max_reading_order: Optional[int] = None,
    ) -> list[RetrievalCandidate]:
        reading_order_filter = ""
        if max_reading_order is not None:
            reading_order_filter = """
                AND rc.start_reading_order <= :max_reading_order
                AND rc.end_reading_order <= :max_reading_order
            """

        sql = text(f"""
            SELECT
                rc.id,
                rc.chunk_order,
                rc.raw_text,
                rc.start_reading_order,
                rc.end_reading_order,
                rc.chapter_id,
                rc.chapter_title,
                rc.page_start,
                rc.page_end,
                rc.paragraph_ids,
                rc.source_refs,
                ts_rank_cd(rc.search_vector, websearch_to_tsquery('english', :query)) AS keyword_rank
            FROM rag_chunks rc
            JOIN index_versions iv ON iv.id = rc.index_version_id
            JOIN books b ON b.active_index_version_id = iv.id
            WHERE b.id = :book_id
              AND b.user_id = :user_id
              AND rc.search_vector @@ websearch_to_tsquery('english', :query)
              {reading_order_filter}
            ORDER BY keyword_rank DESC
            LIMIT :limit
        """)

        params = {
            "book_id": str(book_id),
            "user_id": str(user_id),
            "query": query,
            "limit": limit,
        }
        if max_reading_order is not None:
            params["max_reading_order"] = max_reading_order

        with self._factory() as session:
            rows = session.execute(sql, params).fetchall()

        return [
            RetrievalCandidate(
                chunk_id=row[0],
                chunk_order=row[1],
                raw_text=row[2],
                start_reading_order=row[3],
                end_reading_order=row[4],
                chapter_id=row[5],
                chapter_title=row[6],
                page_start=row[7],
                page_end=row[8],
                paragraph_ids=row[9] or [],
                source_refs=row[10] or [],
                keyword_rank=float(row[11]) if row[11] is not None else None,
            )
            for row in rows
        ]

    def get_neighbors(
        self,
        user_id: UUID,
        book_id: UUID,
        chunk_order: int,
        chapter_id: Optional[str],
        max_reading_order: Optional[int] = None,
    ) -> list[RetrievalCandidate]:
        reading_order_filter = ""
        if max_reading_order is not None:
            reading_order_filter = (
                "AND rc.start_reading_order <= :max_reading_order "
                "AND rc.end_reading_order <= :max_reading_order"
            )

        chapter_filter = ""
        if chapter_id is not None:
            chapter_filter = "AND rc.chapter_id = :chapter_id"

        sql = text(f"""
            SELECT
                rc.id,
                rc.chunk_order,
                rc.raw_text,
                rc.start_reading_order,
                rc.end_reading_order,
                rc.chapter_id,
                rc.chapter_title,
                rc.page_start,
                rc.page_end,
                rc.paragraph_ids,
                rc.source_refs,
                NULL AS vector_similarity
            FROM rag_chunks rc
            JOIN index_versions iv ON iv.id = rc.index_version_id
            JOIN books b ON b.active_index_version_id = iv.id
            WHERE b.id = :book_id
              AND b.user_id = :user_id
              AND rc.chunk_order IN (:prev_order, :next_order)
              {chapter_filter}
              {reading_order_filter}
        """)

        params: dict = {
            "book_id": str(book_id),
            "user_id": str(user_id),
            "prev_order": chunk_order - 1,
            "next_order": chunk_order + 1,
        }
        if chapter_id is not None:
            params["chapter_id"] = chapter_id
        if max_reading_order is not None:
            params["max_reading_order"] = max_reading_order

        with self._factory() as session:
            rows = session.execute(sql, params).fetchall()

        return [
            RetrievalCandidate(
                chunk_id=row[0],
                chunk_order=row[1],
                raw_text=row[2],
                start_reading_order=row[3],
                end_reading_order=row[4],
                chapter_id=row[5],
                chapter_title=row[6],
                page_start=row[7],
                page_end=row[8],
                paragraph_ids=row[9] or [],
                source_refs=row[10] or [],
            )
            for row in rows
        ]
