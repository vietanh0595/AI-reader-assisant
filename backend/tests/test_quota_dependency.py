from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException

from backend.app.quota_dependency import enforce_daily_quota
from backend.app.quota import QuotaExceeded


class FakeUserQuota:
    def __init__(self, raises=False):
        self.calls = []
        self._raises = raises

    def consume(self, user_id, *, limit, today):
        self.calls.append((user_id, limit, today))
        if self._raises:
            raise QuotaExceeded(limit=limit, resets_in="", is_guest=False)


class FakeGuestQuota:
    def __init__(self, raises=False):
        self.calls = []
        self._raises = raises

    def consume(self, address, *, today):
        self.calls.append((address, today))
        if self._raises:
            raise QuotaExceeded(limit=10, resets_in="", is_guest=True)


NOW = datetime(2026, 9, 20, 22, 0, tzinfo=timezone.utc)


def test_a_signed_in_reader_is_counted_against_their_account_not_their_address():
    # Counting a signed-in reader by address would share one allowance across a
    # household or an office, and hand them a fresh one on a different network.
    user_quota, guest_quota = FakeUserQuota(), FakeGuestQuota()

    enforce_daily_quota(user_id="user-1", address="1.2.3.4", user_quota=user_quota,
                        guest_quota=guest_quota, limit=50, now=NOW)

    assert user_quota.calls == [("user-1", 50, date(2026, 9, 20))]
    assert guest_quota.calls == []


def test_a_guest_is_counted_against_their_address():
    user_quota, guest_quota = FakeUserQuota(), FakeGuestQuota()

    enforce_daily_quota(user_id=None, address="1.2.3.4", user_quota=user_quota,
                        guest_quota=guest_quota, limit=50, now=NOW)

    assert guest_quota.calls == [("1.2.3.4", date(2026, 9, 20))]
    assert user_quota.calls == []


def test_running_out_is_a_429_and_not_a_500():
    user_quota = FakeUserQuota(raises=True)

    with pytest.raises(HTTPException) as caught:
        enforce_daily_quota(user_id="user-1", address="1.2.3.4", user_quota=user_quota,
                            guest_quota=FakeGuestQuota(), limit=50, now=NOW)

    assert caught.value.status_code == 429


def test_the_refusal_says_when_the_allowance_returns():
    # Without this the reader cannot tell a limit from a breakage.
    with pytest.raises(HTTPException) as caught:
        enforce_daily_quota(user_id="user-1", address="1.2.3.4",
                            user_quota=FakeUserQuota(raises=True),
                            guest_quota=FakeGuestQuota(), limit=50, now=NOW)

    assert "in about 2 hours" in caught.value.detail["message"]


def test_a_guest_refusal_offers_signing_in():
    with pytest.raises(HTTPException) as caught:
        enforce_daily_quota(user_id=None, address="1.2.3.4", user_quota=FakeUserQuota(),
                            guest_quota=FakeGuestQuota(raises=True), limit=50, now=NOW)

    assert caught.value.detail["isGuest"] is True
    assert "sign in" in caught.value.detail["message"].lower()
