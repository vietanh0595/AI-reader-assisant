from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from ..indexing.models import Book, BookBlock
from .consolidator import MindMapConsolidator
from .extractor import ChapterExtractor
from .models import MindMapStatus
from .repository import MindMapRepository
from .schemas import ChapterExtractionResult

logger = logging.getLogger(__name__)

MIN_NODES_REQUIRED = 3


class AlreadyGeneratingError(RuntimeError):
    """Raised when a mind map generation is already in progress for a book."""


class MindMapService:
    def __init__(
        self,
        session_factory: sessionmaker,
        extractor: ChapterExtractor,
        consolidator: MindMapConsolidator,
    ) -> None:
        self._factory = session_factory
        self._extractor = extractor
        self._consolidator = consolidator

    def initiate(self, user_id: UUID, book_id: UUID) -> None:
        with self._factory() as session:
            with session.begin():
                book = session.get(Book, book_id)
                if book is None or book.user_id != user_id:
                    raise ValueError("Book not found")
                repo = MindMapRepository(session)
                existing = repo.get(book_id)
                if existing and existing.status == MindMapStatus.GENERATING:
                    raise AlreadyGeneratingError("already_generating")
                repo.upsert(book_id, MindMapStatus.GENERATING)

    def generate(self, user_id: UUID, book_id: UUID) -> None:
        try:
            self._run_pipeline(book_id)
        except Exception as exc:
            logger.exception("Mind map generation failed for book %s", book_id)
            with self._factory() as session:
                with session.begin():
                    MindMapRepository(session).set_failed(book_id, str(exc))

    def _run_pipeline(self, book_id: UUID) -> None:
        chapters = self._load_chapters(book_id)
        if not chapters:
            self._store_result(book_id, MindMapStatus.INSUFFICIENT_CONTENT, data=None)
            return

        chapter_results: list[ChapterExtractionResult] = []
        detected_genre = "non-fiction"

        for i, (chapter_id, chapter_title, blocks) in enumerate(chapters):
            paragraph_ids = [b.paragraph_id for b in blocks]
            chapter_text = "\n\n".join(b.text for b in blocks)
            is_first = i == 0

            try:
                result = self._extractor.extract(
                    chapter_text=chapter_text,
                    chapter_id=chapter_id or f"ch{i+1}",
                    chapter_title=chapter_title,
                    paragraph_ids=paragraph_ids,
                    is_first_chapter=is_first,
                )
                if is_first and result.genre:
                    detected_genre = result.genre
                chapter_results.append(result)
            except Exception:
                logger.warning("Extraction failed for chapter %s, skipping", chapter_id, exc_info=True)

        if not chapter_results:
            with self._factory() as session:
                with session.begin():
                    MindMapRepository(session).set_failed(book_id, "All chapter extractions failed")
            return

        consolidated = self._consolidator.consolidate(
            chapters=chapter_results,
            detected_genre=detected_genre,
        )

        if len(consolidated.nodes) < MIN_NODES_REQUIRED:
            self._store_result(book_id, MindMapStatus.INSUFFICIENT_CONTENT, data=None)
            return

        data: dict[str, Any] = {
            "genre": consolidated.genre,
            "nodes": [n.model_dump(by_alias=True) for n in consolidated.nodes],
            "edges": [e.model_dump(by_alias=True) for e in consolidated.edges],
        }
        self._store_result(book_id, MindMapStatus.READY, data=data)

    def _load_chapters(
        self, book_id: UUID
    ) -> list[tuple[str | None, str | None, list[BookBlock]]]:
        with self._factory() as session:
            rows = session.scalars(
                select(BookBlock)
                .join(BookBlock.version)
                .join(
                    Book,
                    Book.active_index_version_id == BookBlock.index_version_id,
                )
                .where(Book.id == book_id)
                .order_by(BookBlock.reading_order)
            ).all()

        if not rows:
            return []

        chapters: dict[str | None, list[BookBlock]] = {}
        chapter_titles: dict[str | None, str | None] = {}
        for block in rows:
            key = block.chapter_id
            chapters.setdefault(key, []).append(block)
            if key not in chapter_titles:
                chapter_titles[key] = block.chapter_title

        return [
            (chapter_id, chapter_titles[chapter_id], blocks)
            for chapter_id, blocks in chapters.items()
        ]

    def _store_result(
        self,
        book_id: UUID,
        status: MindMapStatus,
        data: dict[str, Any] | None,
    ) -> None:
        with self._factory() as session:
            with session.begin():
                MindMapRepository(session).upsert(book_id, status, data=data)
