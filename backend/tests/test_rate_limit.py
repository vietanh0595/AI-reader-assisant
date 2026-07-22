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
