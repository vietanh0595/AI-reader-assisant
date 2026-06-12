from __future__ import annotations

import gzip
import hashlib
import json

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

EMBEDDING_MODEL = "text-embedding-3-small"
CHUNKING_VERSION = "v1"


def make_block(reading_order: int = 0, text: str = "Some text.") -> dict:
    return {
        "paragraphId": f"para-{reading_order}",
        "readingOrder": reading_order,
        "blockKind": "body",
        "text": text,
        "sourceRef": {"source": "epub"},
    }


def book_index_request(
    *,
    client_book_id: str = "client-book-1",
    content_hash: str = "a" * 64,
    block_count: int = 1,
) -> dict:
    return {
        "clientBookId": client_book_id,
        "title": "Test Book",
        "author": "Test Author",
        "sourceType": "epub",
        "contentHash": content_hash,
        "blockCount": block_count,
        "parserSchemaVersion": 1,
    }


def batch_request(blocks: list[dict] | None = None) -> dict:
    if blocks is None:
        blocks = [make_block(0)]
    return {"blocks": blocks}


def gzip_json(obj: dict) -> bytes:
    return gzip.compress(json.dumps(obj).encode())


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def create_and_commit_index(
    client: TestClient,
    *,
    content_hash: str = "a" * 64,
    client_book_id: str = "client-book-1",
    migrated_database=None,
) -> dict:
    created = client.post(
        "/library/books/index", json=book_index_request(content_hash=content_hash, client_book_id=client_book_id)
    ).json()
    book_id = created["bookId"]
    version_id = created["versionId"]
    body = gzip_json(batch_request())
    client.put(
        f"/library/books/{book_id}/index/versions/{version_id}/batches/0",
        content=body,
        headers={"Idempotency-Key": "batch-0", "X-Payload-SHA256": sha256_of(body), "Content-Encoding": "gzip"},
    )
    client.post(f"/library/books/{book_id}/index/versions/{version_id}/commit")

    if migrated_database is not None:
        from sqlalchemy.orm import Session as OrmSession
        from uuid import UUID
        from backend.app.indexing.models import IndexVersion, IndexVersionStatus
        with OrmSession(migrated_database) as s:
            with s.begin():
                v = s.get(IndexVersion, UUID(version_id))
                if v:
                    v.status = IndexVersionStatus.READY

    return created




# ---------------------------------------------------------------------------
# Create / resume
# ---------------------------------------------------------------------------


def test_create_index_returns_book_and_version_ids(auth_client: TestClient) -> None:
    resp = auth_client.post("/library/books/index", json=book_index_request())
    assert resp.status_code == 200
    body = resp.json()
    assert "bookId" in body
    assert "versionId" in body
    assert body["reused"] is False


def test_create_index_is_idempotent_for_same_client_book(auth_client: TestClient) -> None:
    first = auth_client.post("/library/books/index", json=book_index_request()).json()
    second = auth_client.post("/library/books/index", json=book_index_request()).json()
    assert first["bookId"] == second["bookId"]
    assert first["versionId"] == second["versionId"]


def test_completed_content_hash_is_reused_only_for_same_user(
    auth_client: TestClient, other_auth_client: TestClient, migrated_database
) -> None:
    # Create and mark a version as ready for the same book + content hash
    create_and_commit_index(
        auth_client, content_hash="b" * 64, client_book_id="client-book-1", migrated_database=migrated_database
    )
    same_user = auth_client.post("/library/books/index", json=book_index_request(content_hash="b" * 64))
    other_user = other_auth_client.post(
        "/library/books/index", json=book_index_request(content_hash="b" * 64)
    )
    assert same_user.json()["reused"] is True
    assert other_user.json()["reused"] is False


# ---------------------------------------------------------------------------
# Batch upload
# ---------------------------------------------------------------------------


def test_upload_batch_succeeds(auth_client: TestClient) -> None:
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    book_id, version_id = created["bookId"], created["versionId"]
    body = gzip_json(batch_request())
    resp = auth_client.put(
        f"/library/books/{book_id}/index/versions/{version_id}/batches/0",
        content=body,
        headers={"Idempotency-Key": "key-0", "X-Payload-SHA256": sha256_of(body), "Content-Encoding": "gzip"},
    )
    assert resp.status_code == 200
    assert resp.json()["replayed"] is False


def test_identical_batch_replay_is_idempotent(auth_client: TestClient) -> None:
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    book_id, version_id = created["bookId"], created["versionId"]
    path = f"/library/books/{book_id}/index/versions/{version_id}/batches/0"
    body = gzip_json(batch_request())
    headers = {"Idempotency-Key": "batch-key", "X-Payload-SHA256": sha256_of(body), "Content-Encoding": "gzip"}

    first = auth_client.put(path, content=body, headers=headers)
    second = auth_client.put(path, content=body, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["replayed"] is True


def test_conflicting_batch_replay_returns_409(auth_client: TestClient) -> None:
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    book_id, version_id = created["bookId"], created["versionId"]
    path = f"/library/books/{book_id}/index/versions/{version_id}/batches/0"

    body_a = gzip_json(batch_request([make_block(0, "first")]))
    body_b = gzip_json(batch_request([make_block(0, "second")]))
    auth_client.put(
        path,
        content=body_a,
        headers={"Idempotency-Key": "key-A", "X-Payload-SHA256": sha256_of(body_a), "Content-Encoding": "gzip"},
    )
    resp = auth_client.put(
        path,
        content=body_b,
        headers={"Idempotency-Key": "key-A", "X-Payload-SHA256": sha256_of(body_b), "Content-Encoding": "gzip"},
    )
    assert resp.status_code == 409


def test_batch_missing_idempotency_key_returns_422(auth_client: TestClient) -> None:
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    book_id, version_id = created["bookId"], created["versionId"]
    resp = auth_client.put(
        f"/library/books/{book_id}/index/versions/{version_id}/batches/0",
        content=gzip_json(batch_request()),
        headers={"X-Payload-SHA256": "hash-0", "Content-Encoding": "gzip"},
    )
    assert resp.status_code == 422


def test_malformed_gzip_body_returns_400(auth_client: TestClient) -> None:
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    book_id, version_id = created["bookId"], created["versionId"]
    resp = auth_client.put(
        f"/library/books/{book_id}/index/versions/{version_id}/batches/0",
        content=b"not-gzip",
        headers={"Idempotency-Key": "key-0", "X-Payload-SHA256": "hash-0", "Content-Encoding": "gzip"},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Commit
# ---------------------------------------------------------------------------


def test_commit_transitions_to_queued(auth_client: TestClient) -> None:
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    book_id, version_id = created["bookId"], created["versionId"]
    body = gzip_json(batch_request())
    auth_client.put(
        f"/library/books/{book_id}/index/versions/{version_id}/batches/0",
        content=body,
        headers={"Idempotency-Key": "key-0", "X-Payload-SHA256": sha256_of(body), "Content-Encoding": "gzip"},
    )
    resp = auth_client.post(f"/library/books/{book_id}/index/versions/{version_id}/commit")
    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"


def test_commit_fails_without_all_batches(auth_client: TestClient) -> None:
    created = auth_client.post(
        "/library/books/index", json=book_index_request(block_count=300)
    ).json()
    book_id, version_id = created["bookId"], created["versionId"]
    resp = auth_client.post(f"/library/books/{book_id}/index/versions/{version_id}/commit")
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


def test_status_returns_current_state(auth_client: TestClient) -> None:
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    book_id = created["bookId"]
    resp = auth_client.get(f"/library/books/{book_id}/index/status")
    assert resp.status_code == 200
    assert resp.json()["status"] in ("uploading", "queued", "indexing", "ready", "failed")


# ---------------------------------------------------------------------------
# Ownership
# ---------------------------------------------------------------------------


def test_other_user_cannot_access_book(auth_client: TestClient, other_auth_client: TestClient) -> None:
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    book_id = created["bookId"]
    resp = other_auth_client.get(f"/library/books/{book_id}/index/status")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


def test_delete_index_removes_book(auth_client: TestClient) -> None:
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    book_id = created["bookId"]
    del_resp = auth_client.delete(f"/library/books/{book_id}/index")
    assert del_resp.status_code in (200, 204)
    status_resp = auth_client.get(f"/library/books/{book_id}/index/status")
    assert status_resp.status_code == 404
