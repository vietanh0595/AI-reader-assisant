"""Add mindmaps table.

Revision ID: 20260626_0003
Revises: 20260611_0002
Create Date: 2026-06-26
"""
from __future__ import annotations
from typing import Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260626_0003"
down_revision: Optional[str] = "20260611_0002"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    op.create_table(
        "mindmaps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("book_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("data", JSONB, nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("book_id", name="uq_mindmaps_book_id"),
    )
    op.create_index("ix_mindmaps_book_id", "mindmaps", ["book_id"])


def downgrade() -> None:
    op.drop_index("ix_mindmaps_book_id", table_name="mindmaps")
    op.drop_table("mindmaps")
