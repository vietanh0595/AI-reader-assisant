"""Add daily_usage table for per-user AI allowances.

Revision ID: 20260920_0004
Revises: 20260626_0003
Create Date: 2026-09-20
"""
from __future__ import annotations
from typing import Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260920_0004"
down_revision: Optional[str] = "20260626_0003"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    op.create_table(
        "daily_usage",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "day", name="uq_daily_usage_user_day"),
    )
    op.create_index("ix_daily_usage_user_id", "daily_usage", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_daily_usage_user_id", table_name="daily_usage")
    op.drop_table("daily_usage")
