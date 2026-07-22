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
