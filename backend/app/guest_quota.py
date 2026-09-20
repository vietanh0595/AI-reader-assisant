"""The allowance for readers without an account.

Kept in memory rather than the database on purpose: writing a row for every
anonymous request would itself be the abuse vector, and a restart clearing a
small trial allowance costs nothing. The signed-in allowance is the one that has
to survive a deploy, and that one is in the database.
"""

from __future__ import annotations

import threading
from datetime import date

from .quota import QuotaExceeded


class GuestDailyQuota:
    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._day: date | None = None
        self._used: dict[str, int] = {}
        # Request handling is threaded, and read-modify-write on a plain dict would
        # let two requests each read the same count and both be allowed.
        self._lock = threading.Lock()

    def consume(self, address: str, *, today: date) -> int:
        with self._lock:
            # Keyed by address and held for as long as the process lives, so the
            # whole map is dropped when the day turns rather than accumulating a
            # row per address seen since boot.
            if self._day != today:
                self._day = today
                self._used = {}

            used = self._used.get(address, 0) + 1

            if used > self._limit:
                raise QuotaExceeded(limit=self._limit, resets_in="", is_guest=True)

            self._used[address] = used
            return used

    def tracked_addresses(self) -> int:
        with self._lock:
            return len(self._used)
