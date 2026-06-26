from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.auth.dependencies import get_current_user
from backend.app.config import Settings
from backend.app.db.models import User
from backend.app.mindmap.models import MindMap, MindMapStatus


BOOK_ID = uuid4()


def _make_fake_user(user_id: UUID | None = None) -> User:
    user = User()
    user.id = user_id or uuid4()
    return user


def _make_auth_app(app_settings: Settings, fake_user: User) -> FastAPI:
    from backend.app.main import create_app

    app = create_app(app_settings)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    return app


@pytest.fixture
def fake_user() -> User:
    return _make_fake_user()


@pytest.fixture
def app(app_settings: Settings, fake_user: User) -> FastAPI:
    return _make_auth_app(app_settings, fake_user)


@pytest.fixture
def client(app: FastAPI):
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_post_generate_returns_202(client):
    """POST /mindmap/generate returns 202 with status=generating."""
    mock_service = MagicMock()
    mock_service.initiate.return_value = None

    with patch("backend.app.routers.mindmap._build_mindmap_service", return_value=mock_service):
        response = client.post(f"/library/books/{BOOK_ID}/mindmap/generate")

    assert response.status_code == 202
    assert response.json() == {"status": "generating"}
    mock_service.initiate.assert_called_once()


def test_post_generate_while_generating_returns_409(client):
    """POST /mindmap/generate returns 409 when already generating."""
    mock_service = MagicMock()
    mock_service.initiate.side_effect = RuntimeError("already_generating")

    with patch("backend.app.routers.mindmap._build_mindmap_service", return_value=mock_service):
        response = client.post(f"/library/books/{BOOK_ID}/mindmap/generate")

    assert response.status_code == 409


def test_get_mindmap_returns_404_when_no_record(client):
    """GET /mindmap returns 404 when no mindmap record exists."""
    from backend.app.mindmap.repository import MindMapRepository

    with patch.object(MindMapRepository, "get", return_value=None):
        response = client.get(f"/library/books/{BOOK_ID}/mindmap")

    assert response.status_code == 404


def test_get_mindmap_returns_200_with_ready_data(client):
    """GET /mindmap returns 200 with status=ready and data when record exists."""
    from backend.app.mindmap.repository import MindMapRepository

    ready_data = {
        "genre": "non-fiction",
        "nodes": [
            {
                "id": "n1",
                "label": "Main Theme",
                "type": "theme",
                "summary": "Core idea.",
                "importance": 0.9,
                "passage_ids": ["p1"],
                "chapter": 1,
            }
        ],
        "edges": [],
    }

    fake_mindmap = MindMap(
        book_id=BOOK_ID,
        status=MindMapStatus.READY,
        data=ready_data,
        error=None,
    )

    with patch.object(MindMapRepository, "get", return_value=fake_mindmap):
        response = client.get(f"/library/books/{BOOK_ID}/mindmap")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["data"] == ready_data
