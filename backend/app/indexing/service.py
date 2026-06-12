from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .models import (
    Book,
    BookBlock,
    IndexJob,
    IndexVersion,
    IndexVersionStatus,
    JobStatus,
    UploadBatch,
)
from .repository import (
    DEFAULT_CHUNKING_VERSION,
    DEFAULT_EMBEDDING_DIMENSIONS,
    DEFAULT_EMBEDDING_MODEL,
    create_version,
    find_completed_version_for_hash,
    find_uploading_version,
    get_acknowledged_batch_count,
    get_actual_block_count,
    get_batch,
    get_batch_sequence_numbers,
    get_or_create_book,
    get_owned_book,
    get_owned_version,
)
from .schemas import (
    BatchUploadResponse,
    CreateIndexRequest,
    CreateIndexResponse,
    IndexBatchRequest,
    IndexBlock,
    IndexStatus,
)

MAX_BLOCKS_PER_BOOK = 100_000
MAX_CHARS_PER_BLOCK = 5_000
MAX_SOURCE_REF_BYTES = 8 * 1024  # 8 KiB
MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024  # 4 MiB


class IndexingService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create_or_resume(
        self, user_id: UUID, request: CreateIndexRequest
    ) -> CreateIndexResponse:
        book = get_or_create_book(
            self._session,
            user_id=user_id,
            client_book_id=request.client_book_id,
            title=request.title,
            author=request.author,
            source_type=request.source_type,
            file_name=request.file_name,
        )

        reused_version = find_completed_version_for_hash(
            self._session,
            user_id=user_id,
            book_id=book.id,
            content_hash=request.content_hash,
            embedding_model=DEFAULT_EMBEDDING_MODEL,
            chunking_version=DEFAULT_CHUNKING_VERSION,
        )
        if reused_version:
            return CreateIndexResponse(
                book_id=str(book.id),
                version_id=str(reused_version.id),
                reused=True,
            )

        existing = find_uploading_version(self._session, book.id)
        if existing and existing.content_hash == request.content_hash:
            acked = get_acknowledged_batch_count(self._session, existing.id)
            return CreateIndexResponse(
                book_id=str(book.id),
                version_id=str(existing.id),
                reused=False,
                acknowledged_batches=acked,
            )

        version = create_version(
            self._session,
            book_id=book.id,
            content_hash=request.content_hash,
            embedding_model=DEFAULT_EMBEDDING_MODEL,
            embedding_dimensions=DEFAULT_EMBEDDING_DIMENSIONS,
            chunking_version=DEFAULT_CHUNKING_VERSION,
            expected_block_count=request.block_count,
        )
        self._session.commit()

        return CreateIndexResponse(
            book_id=str(book.id),
            version_id=str(version.id),
            reused=False,
        )

    def store_batch(
        self,
        user_id: UUID,
        book_id: UUID,
        version_id: UUID,
        sequence_number: int,
        idempotency_key: str,
        payload_hash: str,
        request: IndexBatchRequest,
    ) -> BatchUploadResponse:
        version = get_owned_version(self._session, user_id, book_id, version_id)
        if not version:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found.")
        if version.status != IndexVersionStatus.UPLOADING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Version is not in uploading state (status={version.status}).",
            )

        existing_batch = get_batch(self._session, version_id, sequence_number)
        if existing_batch:
            if existing_batch.payload_hash != payload_hash:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Conflicting batch: payload hash mismatch.",
                )
            return BatchUploadResponse(
                replayed=True,
                sequence_number=sequence_number,
                block_count=existing_batch.block_count,
            )

        self._validate_blocks(request.blocks)

        now = datetime.now(timezone.utc)
        batch = UploadBatch(
            index_version_id=version_id,
            sequence_number=sequence_number,
            idempotency_key=idempotency_key,
            payload_hash=payload_hash,
            block_count=len(request.blocks),
            acknowledged_at=now,
        )
        self._session.add(batch)

        for block in request.blocks:
            text_hash = hashlib.sha256(block.text.encode()).hexdigest()
            self._session.add(
                BookBlock(
                    index_version_id=version_id,
                    paragraph_id=block.paragraph_id,
                    reading_order=block.reading_order,
                    block_kind=block.block_kind,
                    text=block.text,
                    text_hash=text_hash,
                    chapter_id=block.chapter_id,
                    chapter_title=block.chapter_title,
                    source_ref=block.source_ref,
                )
            )

        self._session.commit()

        return BatchUploadResponse(
            replayed=False,
            sequence_number=sequence_number,
            block_count=len(request.blocks),
        )

    def commit(self, user_id: UUID, book_id: UUID, version_id: UUID) -> IndexStatus:
        version = get_owned_version(self._session, user_id, book_id, version_id)
        if not version:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found.")
        if version.status != IndexVersionStatus.UPLOADING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot commit version in status {version.status}.",
            )

        actual_blocks = get_actual_block_count(self._session, version_id)
        if actual_blocks != version.expected_block_count:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Block count mismatch: expected {version.expected_block_count}, "
                    f"got {actual_blocks}."
                ),
            )

        sequences = get_batch_sequence_numbers(self._session, version_id)
        if not sequences or sequences != list(range(len(sequences))):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Batch sequences are missing or non-contiguous.",
            )

        version.status = IndexVersionStatus.QUEUED
        job = IndexJob(
            index_version_id=version_id,
            status=JobStatus.QUEUED,
            next_attempt_at=datetime.now(tz=timezone.utc),
        )
        self._session.add(job)
        self._session.commit()

        return IndexStatus(
            status=version.status,
            progress=version.progress,
            version_id=str(version.id),
        )

    def get_status(self, user_id: UUID, book_id: UUID) -> IndexStatus:
        book = get_owned_book(self._session, user_id, book_id)
        if not book:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found.")

        from sqlalchemy import select as sa_select
        from .models import IndexVersion as IV
        version = self._session.scalar(
            sa_select(IV)
            .where(IV.book_id == book_id)
            .order_by(IV.created_at.desc())
            .limit(1)
        )
        if not version:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No index version found.")

        return IndexStatus(
            status=version.status,
            progress=version.progress,
            error_code=version.error_code,
            error_message=version.error_message,
            version_id=str(version.id),
        )

    def retry(self, user_id: UUID, book_id: UUID, version_id: UUID) -> IndexStatus:
        version = get_owned_version(self._session, user_id, book_id, version_id)
        if not version:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found.")
        if version.status != IndexVersionStatus.FAILED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Can only retry failed versions (status={version.status}).",
            )

        version.status = IndexVersionStatus.QUEUED
        version.error_code = None
        version.error_message = None
        job = IndexJob(
            index_version_id=version_id,
            status=JobStatus.QUEUED,
            next_attempt_at=datetime.now(tz=timezone.utc),
        )
        self._session.add(job)
        self._session.commit()

        return IndexStatus(status=version.status, progress=version.progress, version_id=str(version.id))

    def delete_book_index(self, user_id: UUID, book_id: UUID) -> None:
        book = get_owned_book(self._session, user_id, book_id)
        if not book:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found.")
        self._session.delete(book)
        self._session.commit()

    def _validate_blocks(self, blocks: list[IndexBlock]) -> None:
        for block in blocks:
            if len(block.text) > MAX_CHARS_PER_BLOCK:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Block {block.paragraph_id} text exceeds 5000 characters.",
                )
            source_ref_bytes = len(json.dumps(block.source_ref).encode())
            if source_ref_bytes > MAX_SOURCE_REF_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Block {block.paragraph_id} sourceRef exceeds 8 KiB.",
                )
