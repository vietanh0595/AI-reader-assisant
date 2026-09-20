from datetime import date, datetime, timezone

import pytest

from backend.app.quota import QuotaExceeded, utc_day, describe_reset


def test_the_day_is_utc_so_a_quota_does_not_reset_at_a_random_local_hour():
    moment = datetime(2026, 9, 20, 23, 30, tzinfo=timezone.utc)

    assert utc_day(moment) == date(2026, 9, 20)


def test_a_moment_just_after_midnight_belongs_to_the_new_day():
    assert utc_day(datetime(2026, 9, 21, 0, 1, tzinfo=timezone.utc)) == date(2026, 9, 21)


def test_a_naive_timestamp_is_read_as_utc_rather_than_local_time():
    # Servers run in UTC and tests do not; reading a naive timestamp as local time
    # would silently move the reset boundary.
    assert utc_day(datetime(2026, 9, 20, 23, 30)) == date(2026, 9, 20)


def test_the_reader_is_told_when_the_quota_comes_back():
    # A limit that does not say when it lifts reads as the app being broken.
    moment = datetime(2026, 9, 20, 22, 0, tzinfo=timezone.utc)

    assert describe_reset(moment) == "in about 2 hours"


def test_a_reset_less_than_an_hour_away_is_given_in_minutes():
    moment = datetime(2026, 9, 20, 23, 25, tzinfo=timezone.utc)

    assert describe_reset(moment) == "in about 35 minutes"


def test_the_error_names_the_limit_and_when_it_lifts():
    error = QuotaExceeded(limit=50, resets_in="in about 2 hours", is_guest=False)

    assert "50" in error.message
    assert "in about 2 hours" in error.message


def test_a_guest_is_told_that_signing_in_raises_the_limit():
    # For a guest the limit is the moment they have a reason to make an account,
    # so the message has to say so rather than just refusing.
    error = QuotaExceeded(limit=10, resets_in="in about 3 hours", is_guest=True)

    assert "sign in" in error.message.lower()


def test_a_signed_in_reader_is_not_told_to_sign_in():
    error = QuotaExceeded(limit=50, resets_in="in about 3 hours", is_guest=False)

    assert "sign in" not in error.message.lower()
