from __future__ import annotations

import hashlib
import json
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Book, BookBlock, IndexVersion, IndexVersionStatus, UploadBatch


DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIMENSIONS = 1536
DEFAULT_CHUNKING_VERSION = "v1"


def get_owned_book(session: Session, user_id: UUID, book_id: UUID) -> Optional[Book]:
    return session.scalar(
        select(Book).where(Book.id == book_id, Book.user_id == user_id)
    )


def get_or_create_book(
    session: Session,
    *,
    user_id: UUID,
    client_book_id: str,
    title: str,
    author: str,
    source_type: str,
    file_name: Optional[str],
) -> Book:
    book = session.scalar(
        select(Book).where(
            Book.user_id == user_id,
            Book.client_book_id == client_book_id,
        )
    )
    if book is None:
        book = Book(
            user_id=user_id,
            client_book_id=client_book_id,
            title=title,
            author=author,
            source_type=source_type,
            file_name=file_name,
        )
        session.add(book)
        session.flush()
    return book


def find_committed_version_for_hash(
    session: Session,
    book_id: UUID,
    content_hash: str,
) -> Optional[IndexVersion]:
    """Return a version that is already past uploading (queued/indexing) for the same hash."""
    return session.scalar(
        select(IndexVersion).where(
            IndexVersion.book_id == book_id,
            IndexVersion.content_hash == content_hash,
            IndexVersion.status.in_([IndexVersionStatus.QUEUED, IndexVersionStatus.INDEXING]),
        )
    )


def find_uploading_version(session: Session, book_id: UUID) -> Optional[IndexVersion]:
    return session.scalar(
        select(IndexVersion).where(
            IndexVersion.book_id == book_id,
            IndexVersion.status == IndexVersionStatus.UPLOADING,
        )
    )


def find_completed_version_for_hash(
    session: Session,
    user_id: UUID,
    book_id: UUID,
    content_hash: str,
    embedding_model: str,
    chunking_version: str,
) -> Optional[IndexVersion]:
    return session.scalar(
        select(IndexVersion)
        .join(Book, IndexVersion.book_id == Book.id)
        .where(
            Book.user_id == user_id,
            IndexVersion.book_id == book_id,
            IndexVersion.content_hash == content_hash,
            IndexVersion.embedding_model == embedding_model,
            IndexVersion.chunking_version == chunking_version,
            IndexVersion.status == IndexVersionStatus.READY,
        )
    )


def create_version(
    session: Session,
    *,
    book_id: UUID,
    content_hash: str,
    embedding_model: str,
    embedding_dimensions: int,
    chunking_version: str,
    expected_block_count: int,
) -> IndexVersion:
    version = IndexVersion(
        book_id=book_id,
        content_hash=content_hash,
        embedding_model=embedding_model,
        embedding_dimensions=embedding_dimensions,
        chunking_version=chunking_version,
        expected_block_count=expected_block_count,
        status=IndexVersionStatus.UPLOADING,
    )
    session.add(version)
    session.flush()
    return version


def get_owned_version(
    session: Session, user_id: UUID, book_id: UUID, version_id: UUID
) -> Optional[IndexVersion]:
    return session.scalar(
        select(IndexVersion)
        .join(Book, IndexVersion.book_id == Book.id)
        .where(
            IndexVersion.id == version_id,
            IndexVersion.book_id == book_id,
            Book.user_id == user_id,
        )
    )


def get_batch(
    session: Session, version_id: UUID, sequence_number: int
) -> Optional[UploadBatch]:
    return session.scalar(
        select(UploadBatch).where(
            UploadBatch.index_version_id == version_id,
            UploadBatch.sequence_number == sequence_number,
        )
    )


def get_acknowledged_batch_count(session: Session, version_id: UUID) -> int:
    from sqlalchemy import func
    return session.scalar(
        select(func.count(UploadBatch.id)).where(
            UploadBatch.index_version_id == version_id,
            UploadBatch.acknowledged_at.is_not(None),
        )
    ) or 0


def get_actual_block_count(session: Session, version_id: UUID) -> int:
    from sqlalchemy import func
    return session.scalar(
        select(func.count(BookBlock.id)).where(
            BookBlock.index_version_id == version_id,
        )
    ) or 0


def get_batch_sequence_numbers(session: Session, version_id: UUID) -> list[int]:
    rows = session.scalars(
        select(UploadBatch.sequence_number)
        .where(UploadBatch.index_version_id == version_id)
        .order_by(UploadBatch.sequence_number)
    ).all()
    return list(rows)


def get_book_source_type(session: Session, book_id: UUID) -> str:
    book = session.get(Book, book_id)
    return book.source_type if book else "epub"


def compute_content_hash(session: Session, version_id: UUID, source_type: str) -> str:
    """Replicate the client's hashReaderBook algorithm to verify upload integrity.

    Client (hashBook.ts):
      blockHash = sha256(JSON.stringify([paragraphId, readingOrder, blockKind,
                         chapterId|null, chapterTitle|null, canonicalSourceRef, text.trim()]))
      contentHash = sha256("1\\n{source}\\n" + blockHashes.join("\\n"))
    """
    blocks = session.scalars(
        select(BookBlock)
        .where(BookBlock.index_version_id == version_id)
        .order_by(BookBlock.reading_order)
    ).all()

    block_hashes: list[str] = []
    for block in blocks:
        source_ref = block.source_ref or {}
        # Sort keys and exclude None/null values (mirrors JS canonicalSourceRef)
        canonical_ref = {k: source_ref[k] for k in sorted(source_ref) if source_ref[k] is not None}
        canonical = json.dumps(
            [
                block.paragraph_id,
                int(block.reading_order),  # guard against float from ORM
                block.block_kind,
                block.chapter_id,    # None serialises as null — matches JS ?? null
                block.chapter_title,
                canonical_ref,
                block.text.strip(),
            ],
            separators=(",", ":"),
            ensure_ascii=False,  # JS JSON.stringify keeps Unicode as-is
            sort_keys=True,  # recursively sort nested keys; mirrors JS deepSortKeys
        )
        block_hashes.append(hashlib.sha256(canonical.encode()).hexdigest())

    book_input = f"1\n{source_type}\n" + "\n".join(block_hashes)
    return hashlib.sha256(book_input.encode()).hexdigest()
