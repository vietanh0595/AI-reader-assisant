"""Daily AI allowances.

Two separate guards, doing different jobs. The per-IP burst limiter in
`rate_limit.py` stops hammering; these stop spend. A signed-in reader gets a
generous daily allowance counted against their account, a guest a small one
counted against their address — enough to feel what the app does, nowhere near
enough to use it as a free service.

The guest allowance cannot be scoped to the sample book: the request carries a
client-supplied `bookTitle`, which anyone can set to whatever they like. Size is
the enforcement, not book identity.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone


def utc_day(moment: datetime) -> date:
    """The day an action counts against.

    UTC rather than local time so the reset boundary is the same everywhere and
    does not move when a server does. A naive timestamp is read as UTC — servers
    run in UTC, and guessing local time here would quietly shift the boundary.
    """
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)

    return moment.astimezone(timezone.utc).date()


def describe_reset(moment: datetime) -> str:
    """How long until the allowance comes back, in words.

    A limit that does not say when it lifts reads as the app being broken. Rounded
    deliberately: nobody needs the second, and "in about 2 hours" is easier to act
    on than a timestamp.
    """
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)

    moment = moment.astimezone(timezone.utc)
    midnight = datetime.combine(
        moment.date() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
    )
    remaining = midnight - moment
    minutes = max(1, round(remaining.total_seconds() / 60))

    if minutes < 60:
        return f"in about {minutes} minutes"

    hours = max(1, round(minutes / 60))
    return f"in about {hours} hour{'s' if hours != 1 else ''}"


class QuotaExceeded(Exception):
    """Raised when a reader has used their allowance for the day."""

    def __init__(self, *, limit: int, resets_in: str, is_guest: bool) -> None:
        if is_guest:
            # For a guest this is the first moment they have a concrete reason to
            # make an account, so the message offers that rather than only refusing.
            self.message = (
                f"You've used the {limit} free AI actions available without an account "
                f"today. Sign in for more, or come back {resets_in}."
            )
        else:
            self.message = (
                f"You've used your {limit} AI actions for today. "
                f"They reset {resets_in}."
            )

        self.limit = limit
        self.resets_in = resets_in
        self.is_guest = is_guest
        super().__init__(self.message)
