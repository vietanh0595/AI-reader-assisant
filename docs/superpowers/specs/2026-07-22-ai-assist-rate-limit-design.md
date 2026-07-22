# Rate limiting for the anonymous `/ai/assist` endpoint

## Problem

`/ai/assist` (the inline Explain/Example/Rephrase/Summarize/Ask quick-actions) has no authentication and
no rate limiting — it's intentionally usable by guests with no account, matching this app's
sign-in-optional core reading experience. That's a deliberate product choice, not a bug, but it leaves a
real cost/abuse exposure: anyone who finds the deployed URL can call it as many times as they want,
spending the project's OpenAI budget with no way to identify or throttle them.

The release plan's own infra checklist groups `/ai/assist`, `/ocr/extract`, and the mindmap endpoints
under one "add rate limiting" line item, but that framing has since become inaccurate: `/ocr/extract`
just gained a real auth requirement (a separate fix, same day), and the mindmap/indexing endpoints were
already authenticated. `/ai/assist` is the only one of the group with no identity at all attached to a
request. This design is scoped to that one endpoint only.

**Explicitly out of scope, noted for later:** once the release plan's monetization item ("Define a daily
free-action quota (~20/day) tied to the existing `User` model") is built, it should end up covering
`/ocr/extract`, mindmap, and indexing endpoints too — a per-user quota is the right long-term protection
for anything that already requires sign-in. Building that system here as well would duplicate work the
monetization pass needs to do anyway.

## Design

### Storage: in-memory, single-instance

A small new module, `backend/app/rate_limit.py`, holds an in-memory sliding-window counter keyed by
caller IP. No Redis or other shared cache exists in this stack today (`backend/requirements.txt` has
none), so this is intentionally simple rather than distributed.

**Known trade-off, accepted for now:** if the API ever runs as more than one process/instance, each
instance tracks its own counts independently — the real effective limit becomes (configured limit) ×
(instance count). Fine for a single-instance MVP deployment; revisit if the backend is horizontally
scaled later.

```python
import time
from collections import defaultdict, deque

class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
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
```

This is illustrative of the shape, not final code — the plan will pin down exact naming/structure
against the real file layout.

### Identifying the caller: real client IP, not the proxy's

The release plan targets deploying to Render, which places requests behind a reverse proxy. Using
FastAPI's `request.client.host` directly would return the *proxy's* IP for every request once deployed
— collapsing all guest traffic into what looks like a single caller and making the limiter apply to the
sum of everyone's usage combined, not each guest individually. This must instead read the real client IP
from the `X-Forwarded-For` header (standard proxy convention: the header can contain a comma-separated
chain of IPs when multiple proxies are involved; the **first**/leftmost entry is the original client),
falling back to `request.client.host` only when that header is absent (e.g. local dev, where no proxy
sits in front of the app).

```python
def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
```

### Constants and wiring

```python
AI_ASSIST_RATE_LIMIT_MAX_REQUESTS = 20
AI_ASSIST_RATE_LIMIT_WINDOW_SECONDS = 600  # 10 minutes
```

A single module-level `SlidingWindowRateLimiter` instance backs a FastAPI dependency,
`check_ai_assist_rate_limit(request: Request) -> None`, which calls `get_client_ip(request)`, checks
`is_allowed`, and raises `HTTPException(429, detail="Too many requests — please wait a few minutes and
try again.")` if the limit is exceeded. Wired into the existing `/ai/assist` route in `main.py` as
`Depends(check_ai_assist_rate_limit)`, the same idiomatic shape as the already-existing
`Depends(get_current_user)` used on every other route.

### Frontend

No new UI. `requestAssist()` in `App.tsx` already surfaces any non-OK response's error detail through
the existing inline-assist error path (`if (!response.ok) { const errorDetail = await
readResponseError(response); throw new Error(errorDetail ?? ...); }`). A 429 with the clear message above
flows through that same path with no code change required — deliberately not building a distinct
rate-limit-specific UI treatment, matching the release plan's "lightweight" framing for this item.

## Testing

- `SlidingWindowRateLimiter`: unit tests — requests under the limit are all allowed; the request that
  crosses the limit is rejected; after the window elapses (using an injectable `now` rather than real
  sleeps), a previously-blocked key becomes allowed again; two different keys don't affect each other's
  counts.
- `get_client_ip`: unit tests — no `X-Forwarded-For` header falls back to `request.client.host`; a
  single-IP header is used directly; a multi-IP comma-separated header uses only the first entry.
- A thin integration test on `/ai/assist` confirming the dependency is actually wired in (the 21st
  request within the window gets a 429), using the existing test app/client setup pattern already used
  elsewhere in `backend/tests/`.
