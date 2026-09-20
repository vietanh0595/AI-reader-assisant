"""Durable per-user daily allowance counting."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from .quota import QuotaExceeded

__all__ = ["DailyQuotaStore", "QuotaExceeded"]


class DailyQuotaStore:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._factory = session_factory

    def consume(self, user_id: UUID, *, limit: int, today: date) -> int:
        """Spend one action, or raise if the day's allowance is gone.

        Done as a single upsert that both increments and returns the new count, so
        two requests arriving together cannot each read the old value and let a
        reader over-spend. The row is written first and checked afterwards: a
        request that would exceed the limit is refused, and the increment it made
        is rolled back with it.
        """
        with self._factory() as session:
            with session.begin():
                used = session.execute(
                    text("""
                        INSERT INTO daily_usage (id, user_id, day, used)
                        VALUES (gen_random_uuid(), :user_id, :day, 1)
                        ON CONFLICT (user_id, day)
                        DO UPDATE SET used = daily_usage.used + 1,
                                      updated_at = now()
                        RETURNING used
                    """),
                    {"user_id": str(user_id), "day": today},
                ).scalar_one()

                if used > limit:
                    # Rolling back undoes this request's increment too, so a blocked
                    # reader does not silently climb further above the limit with
                    # every retry — which would matter the moment the limit is raised.
                    session.rollback()
                    raise QuotaExceeded(limit=limit, resets_in="", is_guest=False)

        return used
