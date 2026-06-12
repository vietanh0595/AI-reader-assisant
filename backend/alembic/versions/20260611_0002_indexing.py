"""Add whole-book indexing tables.

Revision ID: 20260611_0002
Revises: 20260611_0001
Create Date: 2026-06-11
"""

from __future__ import annotations

from typing import Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR


revision: str = "20260611_0002"
down_revision: Optional[str] = "20260611_0001"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    op.create_table(
        "books",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("client_book_id", sa.String(200), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("author", sa.String(300), nullable=False),
        sa.Column("source_type", sa.String(20), nullable=False),
        sa.Column("file_name", sa.String(500), nullable=True),
        sa.Column("active_index_version_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "client_book_id", name="ix_books_user_client"),
    )
    op.create_index("ix_books_user_id", "books", ["user_id"])

    op.create_table(
        "index_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("book_id", sa.Uuid(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("embedding_model", sa.String(100), nullable=False),
        sa.Column("embedding_dimensions", sa.Integer(), nullable=False),
        sa.Column("chunking_version", sa.String(20), nullable=False),
        sa.Column("expected_block_count", sa.Integer(), nullable=False),
        sa.Column("received_block_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_index_versions_book_id", "index_versions", ["book_id"])

    op.create_foreign_key(
        "fk_books_active_index_version",
        "books",
        "index_versions",
        ["active_index_version_id"],
        ["id"],
        ondelete="SET NULL",
        use_alter=True,
    )

    op.create_table(
        "book_blocks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("index_version_id", sa.Uuid(), nullable=False),
        sa.Column("paragraph_id", sa.String(160), nullable=False),
        sa.Column("reading_order", sa.Integer(), nullable=False),
        sa.Column("block_kind", sa.String(40), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("text_hash", sa.String(64), nullable=False),
        sa.Column("chapter_id", sa.String(160), nullable=True),
        sa.Column("chapter_title", sa.String(300), nullable=True),
        sa.Column("source_ref", JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["index_version_id"], ["index_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("index_version_id", "reading_order", name="ix_book_blocks_version_order"),
    )
    op.create_index("ix_book_blocks_version_id", "book_blocks", ["index_version_id"])

    op.create_table(
        "upload_batches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("index_version_id", sa.Uuid(), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("block_count", sa.Integer(), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["index_version_id"], ["index_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("index_version_id", "sequence_number", name="ix_upload_batches_version_sequence"),
    )
    op.create_index("ix_upload_batches_version_id", "upload_batches", ["index_version_id"])

    op.create_table(
        "rag_chunks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("index_version_id", sa.Uuid(), nullable=False),
        sa.Column("chunk_order", sa.Integer(), nullable=False),
        sa.Column("chunk_hash", sa.String(64), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("embedding_input_text", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("overlap_token_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("start_reading_order", sa.Integer(), nullable=False),
        sa.Column("end_reading_order", sa.Integer(), nullable=False),
        sa.Column("chapter_id", sa.String(160), nullable=True),
        sa.Column("chapter_title", sa.String(300), nullable=True),
        sa.Column("page_start", sa.Integer(), nullable=True),
        sa.Column("page_end", sa.Integer(), nullable=True),
        sa.Column("paragraph_ids", JSONB(), nullable=False, server_default="[]"),
        sa.Column("source_refs", JSONB(), nullable=False, server_default="[]"),
        sa.Column("embedding", sa.Text(), nullable=True),  # placeholder; overridden below
        sa.Column("search_vector", TSVECTOR(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["index_version_id"], ["index_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("index_version_id", "chunk_order", name="ix_rag_chunks_version_order"),
    )
    op.create_index("ix_rag_chunks_version_id", "rag_chunks", ["index_version_id"])

    # Replace placeholder text column with vector(1536)
    op.execute("ALTER TABLE rag_chunks DROP COLUMN embedding")
    op.execute("ALTER TABLE rag_chunks ADD COLUMN embedding vector(1536)")

    op.execute("CREATE INDEX ix_rag_chunks_embedding ON rag_chunks USING hnsw (embedding vector_cosine_ops)")
    op.execute("CREATE INDEX ix_rag_chunks_search_vector ON rag_chunks USING gin (search_vector)")

    op.create_table(
        "index_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("index_version_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("lease_owner", sa.String(200), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["index_version_id"], ["index_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_index_jobs_claim",
        "index_jobs",
        ["status", "next_attempt_at", "lease_expires_at"],
    )
    op.create_index("ix_index_jobs_version_id", "index_jobs", ["index_version_id"])


def downgrade() -> None:
    op.drop_table("index_jobs")
    op.drop_table("rag_chunks")
    op.drop_table("upload_batches")
    op.drop_table("book_blocks")
    op.drop_constraint("fk_books_active_index_version", "books", type_="foreignkey")
    op.drop_table("index_versions")
    op.drop_table("books")
