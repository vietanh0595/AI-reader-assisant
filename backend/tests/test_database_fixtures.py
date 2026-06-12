import pytest


def test_test_database_url_must_end_in_test():
    from backend.tests import conftest

    with pytest.raises(RuntimeError, match="ending in '_test'"):
        conftest.require_test_database_url(
            "postgresql+psycopg://reader:reader@localhost:5432/reader"
        )


def test_configured_test_database_url_is_validated(monkeypatch):
    from backend.tests import conftest

    monkeypatch.setenv(
        "TEST_DATABASE_URL",
        "postgresql+psycopg://reader:reader@localhost:5432/reader",
    )

    with pytest.raises(RuntimeError, match="ending in '_test'"):
        conftest.get_test_database_url()
