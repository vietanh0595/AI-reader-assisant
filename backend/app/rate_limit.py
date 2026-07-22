from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


AI_ASSIST_RATE_LIMIT_MAX_REQUESTS = 20
AI_ASSIST_RATE_LIMIT_WINDOW_SECONDS = 600.0  # 10 minutes


class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self._max_requests = max_requests
        self._window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)

    def is_allowed(self, key: str, now: float | None = None) -> bool:
        current_time = now if now is not None else time.monotonic()
        timestamps = self._requests[key]

        while timestamps and current_time - timestamps[0] > self._window_seconds:
            timestamps.popleft()

        if len(timestamps) >= self._max_requests:
            return False

        timestamps.append(current_time)
        return True


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


_ai_assist_limiter = SlidingWindowRateLimiter(
    max_requests=AI_ASSIST_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=AI_ASSIST_RATE_LIMIT_WINDOW_SECONDS,
)


def check_ai_assist_rate_limit(request: Request) -> None:
    client_ip = get_client_ip(request)
    if not _ai_assist_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests — please wait a few minutes and try again.",
        )
