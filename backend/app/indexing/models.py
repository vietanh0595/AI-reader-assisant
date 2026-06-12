from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from pgvector.sqlalchemy import Vector

from ..db.base import Base, UuidTimestampMixin


class IndexVersionStatus(str, Enum):
    UPLOADING = "uploading"
    QUEUED = "queued"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"
    DELETING = "deleting"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    RETRY = "retry"
    COMPLETE = "complete"
    FAILED = "failed"


class Book(UuidTimestampMixin, Base):
    __tablename__ = "books"
    __table_args__ = (
        UniqueConstraint("user_id", "client_book_id", name="ix_books_user_client"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    client_book_id: Mapped[str] = mapped_column(String(200), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str] = mapped_column(String(300), nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    file_name: Mapped[Optional[str]] = mapped_column(String(500))
    active_index_version_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("index_versions.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
    )

    index_versions: Mapped[list["IndexVersion"]] = relationship(
        back_populates="book",
        cascade="all, delete-orphan",
        foreign_keys="IndexVersion.book_id",
    )


class IndexVersion(UuidTimestampMixin, Base):
    __tablename__ = "index_versions"

    book_id: Mapped[UUID] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(100), nullable=False)
    embedding_dimensions: Mapped[int] = mapped_column(Integer, nullable=False)
    chunking_version: Mapped[str] = mapped_column(String(20), nullable=False)
    expected_block_count: Mapped[int] = mapped_column(Integer, nullable=False)
    received_block_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    progress: Mapped[float] = mapped_column(default=0.0, nullable=False)
    error_code: Mapped[Optional[str]] = mapped_column(String(100))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    book: Mapped[Book] = relationship(
        back_populates="index_versions",
        foreign_keys=[book_id],
    )
    blocks: Mapped[list["BookBlock"]] = relationship(
        back_populates="version",
        cascade="all, delete-orphan",
    )
    upload_batches: Mapped[list["UploadBatch"]] = relationship(
        back_populates="version",
        cascade="all, delete-orphan",
    )
    chunks: Mapped[list["RagChunk"]] = relationship(
        back_populates="version",
        cascade="all, delete-orphan",
    )
    jobs: Mapped[list["IndexJob"]] = relationship(
        back_populates="version",
        cascade="all, delete-orphan",
    )


class BookBlock(UuidTimestampMixin, Base):
    __tablename__ = "book_blocks"
    __table_args__ = (
        UniqueConstraint(
            "index_version_id", "reading_order", name="ix_book_blocks_version_order"
        ),
        Index("ix_book_blocks_version_id", "index_version_id"),
    )

    index_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("index_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    paragraph_id: Mapped[str] = mapped_column(String(160), nullable=False)
    reading_order: Mapped[int] = mapped_column(Integer, nullable=False)
    block_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    text_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    chapter_id: Mapped[Optional[str]] = mapped_column(String(160))
    chapter_title: Mapped[Optional[str]] = mapped_column(String(300))
    source_ref: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    version: Mapped[IndexVersion] = relationship(back_populates="blocks")


class UploadBatch(UuidTimestampMixin, Base):
    __tablename__ = "upload_batches"
    __table_args__ = (
        UniqueConstraint(
            "index_version_id", "sequence_number", name="ix_upload_batches_version_sequence"
        ),
        Index("ix_upload_batches_version_id", "index_version_id"),
    )

    index_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("index_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    block_count: Mapped[int] = mapped_column(Integer, nullable=False)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    version: Mapped[IndexVersion] = relationship(back_populates="upload_batches")


class RagChunk(UuidTimestampMixin, Base):
    __tablename__ = "rag_chunks"
    __table_args__ = (
        UniqueConstraint(
            "index_version_id", "chunk_order", name="ix_rag_chunks_version_order"
        ),
        Index("ix_rag_chunks_version_id", "index_version_id"),
    )

    index_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("index_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    chunk_order: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_input_text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    overlap_token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    start_reading_order: Mapped[int] = mapped_column(Integer, nullable=False)
    end_reading_order: Mapped[int] = mapped_column(Integer, nullable=False)
    chapter_id: Mapped[Optional[str]] = mapped_column(String(160))
    chapter_title: Mapped[Optional[str]] = mapped_column(String(300))
    page_start: Mapped[Optional[int]] = mapped_column(Integer)
    page_end: Mapped[Optional[int]] = mapped_column(Integer)
    paragraph_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    source_refs: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(1536))
    search_vector: Mapped[Optional[Any]] = mapped_column(TSVECTOR)

    version: Mapped[IndexVersion] = relationship(back_populates="chunks")


class IndexJob(UuidTimestampMixin, Base):
    __tablename__ = "index_jobs"
    __table_args__ = (
        Index("ix_index_jobs_version_id", "index_version_id"),
        Index("ix_index_jobs_claim", "status", "next_attempt_at", "lease_expires_at"),
    )

    index_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("index_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    progress: Mapped[float] = mapped_column(default=0.0, nullable=False)
    lease_owner: Mapped[Optional[str]] = mapped_column(String(200))
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[Optional[str]] = mapped_column(String(100))
    error_message: Mapped[Optional[str]] = mapped_column(Text)

    version: Mapped[IndexVersion] = relationship(back_populates="jobs")
