from __future__ import annotations

import hashlib
import time
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
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

    def process(self, job: Any) -> None:
        job_id = job.id
        version_id = job.index_version_id
        worker_id = f"{_WORKER_ID_PREFIX}-{job_id}"

        try:
            self._mark_indexing(version_id)
            blocks = self._load_blocks(version_id)
            chunks = self._chunker.chunk(blocks)
            self._embed_and_store_chunks(version_id, chunks, job_id, worker_id)
            self._activate_version(version_id)
            self._jobs.complete(job_id, worker_id)
        except Exception as exc:
            self._mark_failed(version_id)
            self._jobs.fail_permanent(job_id, worker_id, "indexing_error", str(exc))
            raise

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
        job_id: UUID,
        worker_id: str,
    ) -> None:
        texts = [c.embedding_input_text for c in chunks]
        embeddings = self._embedder.embed_documents(texts)

        with self._factory() as session:
            with session.begin():
                for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                    chunk_hash = hashlib.sha256(chunk.embedding_input_text.encode()).hexdigest()
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
                        embedding=embedding,
                    )
                    session.add(rag_chunk)

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

    def _mark_failed(self, version_id: UUID) -> None:
        with self._factory() as session:
            with session.begin():
                ver = session.get(IndexVersion, version_id)
                if ver:
                    ver.status = IndexVersionStatus.FAILED

    def run_forever(self, poll_seconds: float = 2.0) -> None:
        import socket
        worker_id = f"{_WORKER_ID_PREFIX}-{socket.gethostname()}"
        while True:
            job = self._jobs.claim(worker_id)
            if job is not None:
                try:
                    self.process(job)
                except Exception:
                    pass
            else:
                time.sleep(poll_seconds)
