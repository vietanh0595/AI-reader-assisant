from __future__ import annotations

import hashlib
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

logger = logging.getLogger(__name__)

from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from .chunker import StructureAwareChunker
from .embeddings import EmbeddingProvider
from .jobs import JobRepository
from .models import (
    Book,
    BookBlock,
    IndexJob,
    IndexVersion,
    IndexVersionStatus,
    JobStatus,
    RagChunk,
)

_HEARTBEAT_INTERVAL = 20  # seconds
_WORKER_ID_PREFIX = "worker"


class IndexWorker:
    def __init__(
        self,
        session_factory: sessionmaker,
        embedding_provider: EmbeddingProvider,
        chunker: Optional[StructureAwareChunker] = None,
    ) -> None:
        self._factory = session_factory
        self._embedder = embedding_provider
        self._chunker = chunker or StructureAwareChunker()
        self._jobs = JobRepository(session_factory)

    def process(self, job: Any, worker_id: str | None = None) -> None:
        job_id = job.id
        version_id = job.index_version_id
        effective_worker_id = worker_id or getattr(job, "lease_owner", None) or f"{_WORKER_ID_PREFIX}-{job_id}"

        stop_event = threading.Event()

        def _heartbeat_loop() -> None:
            while not stop_event.wait(_HEARTBEAT_INTERVAL):
                self._jobs.heartbeat(job_id, effective_worker_id)

        hb_thread = threading.Thread(target=_heartbeat_loop, daemon=True)
        hb_thread.start()
        try:
            self._mark_indexing(version_id)
            blocks = self._load_blocks(version_id)
            chunks = self._chunker.chunk(blocks)
            self._embed_and_store_chunks(version_id, chunks)
            self._activate_version(version_id)
            self._jobs.complete(job_id, effective_worker_id)
        except Exception as exc:
            self._mark_failed(version_id, "indexing_error", str(exc))
            self._jobs.fail_retryable(job_id, effective_worker_id, "indexing_error", str(exc))
            raise
        finally:
            stop_event.set()

    def _mark_indexing(self, version_id: UUID) -> None:
        with self._factory() as session:
            with session.begin():
                ver = session.get(IndexVersion, version_id)
                if ver:
                    ver.status = IndexVersionStatus.INDEXING
                    ver.started_at = datetime.now(tz=timezone.utc)

    def _load_blocks(self, version_id: UUID) -> list[BookBlock]:
        with self._factory() as session:
            blocks = session.scalars(
                select(BookBlock)
                .where(BookBlock.index_version_id == version_id)
                .order_by(BookBlock.reading_order)
            ).all()
            return list(blocks)

    def _embed_and_store_chunks(
        self,
        version_id: UUID,
        chunks: list[Any],
    ) -> None:
        texts = [c.embedding_input_text for c in chunks]
        embeddings = self._embedder.embed_documents(texts)

        with self._factory() as session:
            with session.begin():
                # Wipe any chunks left over from a prior crashed attempt so that
                # reprocessing doesn't hit the (index_version_id, chunk_order)
                # unique constraint.
                session.execute(
                    text("DELETE FROM rag_chunks WHERE index_version_id = :vid"),
                    {"vid": str(version_id)},
                )
                for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                    chunk_hash = hashlib.sha256(chunk.embedding_input_text.encode()).hexdigest()
                    page_indices = [
                        ref["pageIndex"]
                        for ref in chunk.source_refs
                        if isinstance(ref.get("pageIndex"), int)
                    ]
                    rag_chunk = RagChunk(
                        index_version_id=version_id,
                        chunk_order=i,
                        chunk_hash=chunk_hash,
                        raw_text=chunk.raw_text,
                        embedding_input_text=chunk.embedding_input_text,
                        token_count=chunk.token_count,
                        overlap_token_count=chunk.overlap_token_count,
                        start_reading_order=chunk.reading_order_start,
                        end_reading_order=chunk.reading_order_end,
                        chapter_id=chunk.chapter_id,
                        chapter_title=chunk.chapter_title,
                        paragraph_ids=chunk.paragraph_ids,
                        source_refs=chunk.source_refs,
                        page_start=min(page_indices) if page_indices else None,
                        page_end=max(page_indices) if page_indices else None,
                        embedding=embedding,
                    )
                    session.add(rag_chunk)

                session.flush()
                session.execute(
                    text(
                        "UPDATE rag_chunks SET search_vector = to_tsvector('english', embedding_input_text) "
                        "WHERE index_version_id = :version_id AND search_vector IS NULL"
                    ),
                    {"version_id": str(version_id)},
                )

    def _activate_version(self, version_id: UUID) -> None:
        with self._factory() as session:
            with session.begin():
                ver = session.get(IndexVersion, version_id)
                if ver is None:
                    return
                ver.status = IndexVersionStatus.READY
                ver.progress = 1.0
                ver.completed_at = datetime.now(tz=timezone.utc)

                book = session.get(Book, ver.book_id)
                if book:
                    book.active_index_version_id = version_id

    def _mark_failed(self, version_id: UUID, error_code: str = "indexing_error", error_message: str = "") -> None:
        with self._factory() as session:
            with session.begin():
                ver = session.get(IndexVersion, version_id)
                if ver:
                    ver.status = IndexVersionStatus.FAILED
                    ver.error_code = error_code
                    ver.error_message = error_message

    def run_forever(self, poll_seconds: float = 2.0) -> None:
        import socket
        worker_id = f"{_WORKER_ID_PREFIX}-{socket.gethostname()}"
        logger.info("Worker started: %s", worker_id)
        while True:
            job = self._jobs.claim(worker_id)
            if job is not None:
                logger.info("Claimed job %s for version %s", job.id, job.index_version_id)
                try:
                    self.process(job, worker_id)
                    logger.info("Job %s completed successfully", job.id)
                except Exception:
                    logger.exception("Job %s failed", job.id)
            else:
                time.sleep(poll_seconds)
