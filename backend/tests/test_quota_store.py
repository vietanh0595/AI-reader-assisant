from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from backend.app.quota_store import DailyQuotaStore, QuotaExceeded


@pytest.fixture
def store(migrated_database):
    from sqlalchemy.orm import sessionmaker

    return DailyQuotaStore(sessionmaker(migrated_database))


def test_the_first_action_of_the_day_is_allowed(store, committed_user):
    store.consume(committed_user, limit=3, today=date(2026, 9, 20))


def test_the_allowance_runs_out_and_then_refuses(store, committed_user):
    for _ in range(3):
        store.consume(committed_user, limit=3, today=date(2026, 9, 20))

    with pytest.raises(QuotaExceeded):
        store.consume(committed_user, limit=3, today=date(2026, 9, 20))


def test_a_new_day_starts_the_allowance_again(store, committed_user):
    for _ in range(3):
        store.consume(committed_user, limit=3, today=date(2026, 9, 20))

    store.consume(committed_user, limit=3, today=date(2026, 9, 21))


def test_one_reader_running_out_does_not_affect_another(store, committed_user, committed_other_user):
    for _ in range(3):
        store.consume(committed_user, limit=3, today=date(2026, 9, 20))

    store.consume(committed_other_user, limit=3, today=date(2026, 9, 20))


def test_raising_the_limit_takes_effect_immediately(store, committed_user):
    # The limit is an environment variable so it can be changed without a deploy.
    # Counts are stored, the limit is not, so a reader who was blocked is unblocked
    # the moment the number goes up.
    for _ in range(3):
        store.consume(committed_user, limit=3, today=date(2026, 9, 20))

    store.consume(committed_user, limit=5, today=date(2026, 9, 20))


def test_the_count_survives_a_new_store(store, committed_user, migrated_database):
    # In-memory counting would reset on every deploy, and a quota that clears when
    # you ship is not a quota.
    from sqlalchemy.orm import sessionmaker

    for _ in range(3):
        store.consume(committed_user, limit=3, today=date(2026, 9, 20))

    fresh = DailyQuotaStore(sessionmaker(migrated_database))

    with pytest.raises(QuotaExceeded):
        fresh.consume(committed_user, limit=3, today=date(2026, 9, 20))


def test_a_refused_request_does_not_keep_inflating_the_count(store, committed_user):
    # The limit is an env var meant to be raised without a deploy. If every refused
    # retry still incremented, a reader who kept tapping would climb far above the
    # limit and stay blocked even after it was raised.
    day = date(2026, 9, 20)
    for _ in range(3):
        store.consume(committed_user, limit=3, today=day)

    for _ in range(10):
        with pytest.raises(QuotaExceeded):
            store.consume(committed_user, limit=3, today=day)

    # Raising the limit by one must immediately allow exactly one more action.
    store.consume(committed_user, limit=4, today=day)

    with pytest.raises(QuotaExceeded):
        store.consume(committed_user, limit=4, today=day)
