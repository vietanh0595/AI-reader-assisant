from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import Date, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UuidTimestampMixin


class User(UuidTimestampMixin, Base):
    __tablename__ = "users"

    identities: Mapped[list["ExternalIdentity"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class ExternalIdentity(UuidTimestampMixin, Base):
    __tablename__ = "external_identities"
    __table_args__ = (
        UniqueConstraint("issuer", "subject", name="uq_identity_issuer_subject"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    issuer: Mapped[str] = mapped_column(String(500))
    subject: Mapped[str] = mapped_column(String(500))
    email: Mapped[Optional[str]] = mapped_column(String(320))
    display_name: Mapped[Optional[str]] = mapped_column(String(200))
    user: Mapped[User] = relationship(back_populates="identities")


class DailyUsage(UuidTimestampMixin, Base):
    """How many AI actions a reader has spent on a given day.

    In the database rather than in memory because the process restarts on every
    deploy, and an allowance that clears when you ship is not an allowance.

    Only the count is stored, never the limit: the limit is an environment
    variable, so raising it takes effect immediately for everyone, including
    someone already blocked.
    """

    __tablename__ = "daily_usage"
    __table_args__ = (
        UniqueConstraint("user_id", "day", name="uq_daily_usage_user_day"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    day: Mapped[Date] = mapped_column(Date, nullable=False)
    used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
