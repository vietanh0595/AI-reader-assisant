from __future__ import annotations

from fastapi.testclient import TestClient


_VALID_PAYLOAD = {
    "notes": [{"noteId": "n1", "action": "highlight", "passage": "A passage from the book."}],
}


def test_the_21st_request_within_the_window_is_rate_limited(test_client: TestClient):
    statuses = [
        test_client.post("/notes/anki-cards", json=_VALID_PAYLOAD).status_code
        for _ in range(21)
    ]

    assert 429 not in statuses[:20]
    assert statuses[20] == 429


def test_returns_generated_cards(monkeypatch, test_client: TestClient):
    from backend.app.anki_cards import AnkiCardResult

    def fake_generate(client, model, notes):
        return [AnkiCardResult(note_id=notes[0].note_id, front="Q", back="A")]

    monkeypatch.setattr("backend.app.routers.notes.generate_anki_cards", fake_generate)

    response = test_client.post(
        "/notes/anki-cards",
        json={"notes": [{"noteId": "n1", "action": "explain", "passage": "p", "answer": "a"}]},
    )

    assert response.status_code == 200
    assert response.json() == {"cards": [{"noteId": "n1", "front": "Q", "back": "A"}]}


def test_rejects_an_empty_notes_list(test_client: TestClient):
    response = test_client.post("/notes/anki-cards", json={"notes": []})
    assert response.status_code == 422
