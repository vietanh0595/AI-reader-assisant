"""Spending one AI action against the right allowance."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status

from .quota import QuotaExceeded, describe_reset, utc_day


def enforce_daily_quota(*, user_id, address: str, user_quota, guest_quota,
                        limit: int, now: datetime) -> None:
    """Charge this request to whoever made it, or refuse with a 429.

    A signed-in reader is counted against their account rather than their address:
    counting by address would share one allowance across a household or an office,
    and hand the same person a fresh one on a different network.

    The message is built here rather than where the allowance ran out, because only
    here is the time known — and a refusal that does not say when it lifts is
    indistinguishable from the app being broken.
    """
    try:
        if user_id is not None:
            user_quota.consume(user_id, limit=limit, today=utc_day(now))
        else:
            guest_quota.consume(address, today=utc_day(now))
    except QuotaExceeded as exceeded:
        resets_in = describe_reset(now)
        described = QuotaExceeded(
            limit=exceeded.limit, resets_in=resets_in, is_guest=exceeded.is_guest
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "daily_quota_exceeded",
                "message": described.message,
                "isGuest": exceeded.is_guest,
                "limit": exceeded.limit,
                "resetsIn": resets_in,
            },
        ) from None
