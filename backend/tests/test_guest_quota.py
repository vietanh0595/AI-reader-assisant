from datetime import date

import pytest

from backend.app.quota import QuotaExceeded
from backend.app.guest_quota import GuestDailyQuota


def test_a_guest_gets_a_small_allowance():
    quota = GuestDailyQuota(limit=3)

    for _ in range(3):
        quota.consume("1.2.3.4", today=date(2026, 9, 20))

    with pytest.raises(QuotaExceeded) as caught:
        quota.consume("1.2.3.4", today=date(2026, 9, 20))

    assert caught.value.is_guest is True


def test_one_guest_running_out_does_not_block_another():
    quota = GuestDailyQuota(limit=1)
    quota.consume("1.2.3.4", today=date(2026, 9, 20))

    quota.consume("5.6.7.8", today=date(2026, 9, 20))


def test_a_new_day_starts_the_allowance_again():
    quota = GuestDailyQuota(limit=1)
    quota.consume("1.2.3.4", today=date(2026, 9, 20))

    quota.consume("1.2.3.4", today=date(2026, 9, 21))


def test_yesterdays_addresses_are_not_kept_for_ever():
    # Held in memory and keyed by address, so without pruning this grows for as
    # long as the process lives.
    quota = GuestDailyQuota(limit=5)
    quota.consume("1.2.3.4", today=date(2026, 9, 20))

    quota.consume("5.6.7.8", today=date(2026, 9, 21))

    assert quota.tracked_addresses() == 1
