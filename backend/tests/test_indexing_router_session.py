from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.app.routers.indexing import get_session


class _FakeSessionFactory:
    """Fakes sessionmaker(): calling it returns a context manager yielding a session."""

    def __init__(self) -> None:
        self.entered = False
        self.exited = False
        self.session = object()

    def __call__(self):
        return self

    def __enter__(self):
        self.entered = True
        return self.session

    def __exit__(self, exc_type, exc, tb):
        self.exited = True
        return False


def _fake_request(factory: _FakeSessionFactory) -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(session_factory=factory)))


def test_get_session_is_a_generator_dependency_not_a_plain_return():
    # FastAPI only runs a dependency's post-yield cleanup when the dependency is a
    # generator. A version of this that called next(...) internally and returned a
    # plain Session hid that from FastAPI entirely, so the connection was never
    # released - every request through this router leaked one permanently. This
    # assertion is the direct contract that regression broke.
    factory = _FakeSessionFactory()
    result = get_session(_fake_request(factory))
    assert hasattr(result, "__next__"), "get_session must return a generator, not a value"


def test_get_session_releases_the_connection_after_the_request_completes():
    factory = _FakeSessionFactory()
    gen = get_session(_fake_request(factory))

    session = next(gen)  # FastAPI: enter the dependency, get the yielded value
    assert session is factory.session
    assert factory.entered is True
    assert factory.exited is False  # request is still "in flight" - not released yet

    with pytest.raises(StopIteration):
        next(gen)  # FastAPI: drive past yield once the request finishes

    assert factory.exited is True, "connection was never returned to the pool"
