# AI Assist Rate Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop an anonymous caller from draining the OpenAI budget through `/ai/assist` by rate-limiting it per client IP.

**Architecture:** A small, self-contained module (`backend/app/rate_limit.py`) holds an in-memory sliding-window counter and a FastAPI dependency that checks it, reading the real client IP from `X-Forwarded-For` (since the target deployment host sits behind a reverse proxy) with a local-dev fallback to `request.client.host`. `main.py` wires that dependency onto the existing `/ai/assist` route with no other changes to the route's behavior.

**Tech Stack:** Python, FastAPI, pytest. No new dependencies — no Redis, no third-party rate-limiting library.

## Global Constraints

- Scope is `/ai/assist` only. Do not touch `/ocr/extract`, mindmap, or indexing endpoints — those are already authenticated and will get a per-user quota later as part of the separate monetization work.
- Rate-limit key is the caller's IP address, read from `X-Forwarded-For` (first/leftmost entry) when present, falling back to `request.client.host` otherwise. Never add a new client-generated device ID or schema field for this.
- Limit is exactly 20 requests per 10-minute (600 second) sliding window, per IP.
- Storage is in-memory only (a single process's memory) — no Redis, no external cache. This is an accepted, documented trade-off for a single-instance deployment, not an oversight.
- On exceeding the limit, respond with HTTP 429 and the exact detail message: `"Too many requests — please wait a few minutes and try again."` No new frontend UI — the existing `requestAssist()` error-surfacing path in `App.tsx` already displays any non-OK response's detail message.

---

### Task 1: `SlidingWindowRateLimiter` and `get_client_ip` — pure, unit-tested logic

**Files:**
- Create: `backend/app/rate_limit.py`
- Test: `backend/tests/test_rate_limit.py`

**Interfaces:**
- Produces: `SlidingWindowRateLimiter` (class, methods `__init__(self, max_requests: int, window_seconds: float)` and `is_allowed(self, key: str, now: float | None = None) -> bool`), `get_client_ip(request: Request) -> str` — both consumed by Task 2's dependency wiring in the same file.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_rate_limit.py`:

```python
from __future__ import annotations

from starlette.requests import Request

from backend.app.rate_limit import SlidingWindowRateLimiter, get_client_ip


def test_allows_requests_under_the_limit():
    limiter = SlidingWindowRateLimiter(max_requests=3, window_seconds=60.0)
    assert limiter.is_allowed("1.2.3.4", now=0.0) is True
    assert limiter.is_allowed("1.2.3.4", now=1.0) is True
    assert limiter.is_allowed("1.2.3.4", now=2.0) is True


def test_rejects_the_request_that_crosses_the_limit():
    limiter = SlidingWindowRateLimiter(max_requests=3, window_seconds=60.0)
    limiter.is_allowed("1.2.3.4", now=0.0)
    limiter.is_allowed("1.2.3.4", now=1.0)
    limiter.is_allowed("1.2.3.4", now=2.0)
    assert limiter.is_allowed("1.2.3.4", now=3.0) is False


def test_allows_again_once_the_window_elapses():
    limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=60.0)
    limiter.is_allowed("1.2.3.4", now=0.0)
    limiter.is_allowed("1.2.3.4", now=1.0)
    assert limiter.is_allowed("1.2.3.4", now=2.0) is False
    # First two requests (at t=0 and t=1) have now aged out of a 60s window
    # measured from t=61.
    assert limiter.is_allowed("1.2.3.4", now=61.0) is True


def test_different_keys_do_not_affect_each_other():
    limiter = SlidingWindowRateLimiter(max_requests=1, window_seconds=60.0)
    assert limiter.is_allowed("1.2.3.4", now=0.0) is True
    assert limiter.is_allowed("5.6.7.8", now=0.0) is True
    assert limiter.is_allowed("1.2.3.4", now=1.0) is False


def _make_request(headers: dict[str, str], client_host: str | None) -> Request:
    scope = {
        "type": "http",
        "headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()],
        "client": (client_host, 12345) if client_host else None,
    }
    return Request(scope)


def test_get_client_ip_falls_back_to_request_client_host_without_forwarded_header():
    request = _make_request(headers={}, client_host="9.9.9.9")
    assert get_client_ip(request) == "9.9.9.9"


def test_get_client_ip_uses_single_forwarded_for_ip():
    request = _make_request(headers={"x-forwarded-for": "1.1.1.1"}, client_host="9.9.9.9")
    assert get_client_ip(request) == "1.1.1.1"


def test_get_client_ip_uses_first_ip_in_a_forwarded_chain():
    request = _make_request(headers={"x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3"}, client_host="9.9.9.9")
    assert get_client_ip(request) == "1.1.1.1"


def test_get_client_ip_returns_unknown_when_neither_is_available():
    request = _make_request(headers={}, client_host=None)
    assert get_client_ip(request) == "unknown"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `/Users/vietanh0495/projects/AI-reader-assisant/.venv/bin/python -m pytest -c backend/pytest.ini backend/tests/test_rate_limit.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.app.rate_limit'` (or collection error), since the module doesn't exist yet.

- [ ] **Step 3: Implement the minimal code**

Create `backend/app/rate_limit.py`:

```python
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
```

Note: `_ai_assist_limiter` and `check_ai_assist_rate_limit` are defined here even though Task 2 is what
actually wires `check_ai_assist_rate_limit` into a route — they belong in this file because they share
the same module-level limiter instance as `SlidingWindowRateLimiter`/`get_client_ip`, per the plan's
file-boundary rule (things that change together live together). Task 2 only adds an import and one
`Depends(...)` to `main.py`; it does not add any new logic to this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `/Users/vietanh0495/projects/AI-reader-assisant/.venv/bin/python -m pytest -c backend/pytest.ini backend/tests/test_rate_limit.py -v`
Expected: PASS — all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/rate_limit.py backend/tests/test_rate_limit.py
git commit -m "feat(infra): add a sliding-window rate limiter and client-IP helper"
```

---

### Task 2: Wire the limiter into `/ai/assist`

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_ai_assist_rate_limit.py`

**Interfaces:**
- Consumes: `check_ai_assist_rate_limit` (Task 1, `backend/app/rate_limit.py`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ai_assist_rate_limit.py`:

```python
from __future__ import annotations

from fastapi.testclient import TestClient


_VALID_ASSIST_PAYLOAD = {
    "action": "summarize",
    "author": "Test Author",
    "bookTitle": "Test Book",
    "paragraphText": "Some paragraph text to summarize.",
}


def test_the_21st_request_within_the_window_is_rate_limited(test_client: TestClient):
    statuses = [
        test_client.post("/ai/assist", json=_VALID_ASSIST_PAYLOAD).status_code
        for _ in range(21)
    ]

    assert 429 not in statuses[:20]
    assert statuses[20] == 429
```

This test relies on the `test_client` fixture already defined in `backend/tests/conftest.py`, which
builds the app from a fake `Settings` with `openai_api_key=None` and no database dependency for this
route — `/ai/assist` never touches the database, so this test needs no live Postgres container. Every
one of the first 20 requests is expected to reach `assistant.generate()` and fail with a 500 (missing
OpenAI API key, via `AssistantConfigurationError`) — that's fine and expected; this test only asserts
that none of the first 20 are specifically a 429, and that the 21st specifically is.

The payload uses `action: "summarize"` with `paragraphText` specifically: `AssistRequest`'s
`model_validator` (in `backend/app/schemas.py`) requires `selectedText`/`selectionKind` for every action
*except* `summarize`, and auto-populates `context_blocks` from `paragraphText` when neither is supplied
— this is the smallest payload that passes schema validation (a 422) so the request actually reaches the
rate-limit dependency and, beyond it, `assistant.generate()`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `/Users/vietanh0495/projects/AI-reader-assisant/.venv/bin/python -m pytest -c backend/pytest.ini backend/tests/test_ai_assist_rate_limit.py -v`
Expected: FAIL — `statuses[20]` is `500`, not `429` (no rate limiting wired in yet, so all 21 requests
hit the same `AssistantConfigurationError` path).

- [ ] **Step 3: Wire the dependency into `main.py`**

Find this exact import block in `backend/app/main.py`:

```python
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .auth.dependencies import get_current_user
from .auth.jwt import JwtValidator
from .config import Settings, get_settings
from .db.models import User
from .db.session import create_session_factory
from .openai_assistant import AssistantConfigurationError, AssistantServiceError, OpenAIAssistant
```

Add `.rate_limit` to the import list, right after `.openai_assistant` (alphabetical order):

```python
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .auth.dependencies import get_current_user
from .auth.jwt import JwtValidator
from .config import Settings, get_settings
from .db.models import User
from .db.session import create_session_factory
from .openai_assistant import AssistantConfigurationError, AssistantServiceError, OpenAIAssistant
from .rate_limit import check_ai_assist_rate_limit
```

Find this exact route definition:

```python
    @app.post("/ai/assist", response_model=AssistResponse)
    def assist(request: AssistRequest) -> AssistResponse:
```

Replace with:

```python
    @app.post("/ai/assist", response_model=AssistResponse)
    def assist(
        request: AssistRequest,
        _rate_limit: None = Depends(check_ai_assist_rate_limit),
    ) -> AssistResponse:
```

The rest of the `assist` function body is unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `/Users/vietanh0495/projects/AI-reader-assisant/.venv/bin/python -m pytest -c backend/pytest.ini backend/tests/test_ai_assist_rate_limit.py -v`
Expected: PASS.

- [ ] **Step 5: Run the affected backend tests together**

Run: `/Users/vietanh0495/projects/AI-reader-assisant/.venv/bin/python -m pytest -c backend/pytest.ini backend/tests/test_rate_limit.py backend/tests/test_ai_assist_rate_limit.py backend/tests/test_book_agent.py backend/tests/test_book_answerer.py -v`
Expected: PASS — all tests (the last two files are unrelated to this change but share the same
`AssistRequest`/`AssistAction` types; running them together is a quick regression check that nothing
about the shared schema broke).

- [ ] **Step 6: Full backend regression check**

Run: `/Users/vietanh0495/projects/AI-reader-assisant/.venv/bin/python -m pytest -c backend/pytest.ini backend/tests -q -m "not integration"`
Expected: the same 128 passed / 1 skipped / 12 deselected baseline as before this change, plus this
task's new tests (so 128 + 8 + 1 = 137 passed, roughly — exact count depends on what else is already
in the suite). The same 43 pre-existing errors from tests requiring a live Postgres test container
(`test_book_ask_api.py`, `test_index_upload_api.py`, `test_worker.py`) are expected and unrelated to
this change — do not attempt to fix those as part of this task.

- [ ] **Step 7: Commit**

```bash
git add backend/app/main.py backend/tests/test_ai_assist_rate_limit.py
git commit -m "feat(infra): rate-limit /ai/assist to 20 requests per 10 minutes per IP"
```

---

## Manual verification

Not automatable from this plan's test suite alone (real network behavior through Render's proxy can't
be simulated locally) — verify once deployed:

1. From one device/network, call `/ai/assist` (via the app's Explain/Example/Rephrase/Summarize
   actions) more than 20 times within 10 minutes. Confirm the 21st attempt shows the
   "Too many requests" message instead of an answer.
2. From a second device on a different network, confirm it can still use Explain/etc. normally while
   the first device is rate-limited — confirming the limit is genuinely per-IP, not global.
3. Wait past the 10-minute window on the first device and confirm it can make requests again.
4. Specifically confirm step 1 still triggers correctly *after* deployment behind Render's reverse
   proxy, not just in local dev — this is the one thing that can't be verified locally, since local
   dev has no proxy in front of the app and `X-Forwarded-For` won't be present at all (falling back to
   `request.client.host`, which works locally but would be wrong if the `X-Forwarded-For` reading were
   broken once actually proxied).
