from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..db.models import User
from .jwt import AuthProviderUnavailableError, InvalidAuthTokenError
from .repository import resolve_identity


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> User:
    if credentials is None:
        raise _unauthorized()

    if request.app.state.jwt_validator is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sign-in is not configured.",
        )

    try:
        claims = request.app.state.jwt_validator.validate(credentials.credentials)
    except AuthProviderUnavailableError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sign-in is temporarily unavailable.",
        ) from None
    except InvalidAuthTokenError:
        raise _unauthorized() from None

    with request.app.state.session_factory() as session:
        return resolve_identity(session, claims)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Optional[User]:
    """The signed-in reader, or None.

    Identity is optional on the AI endpoints because a guest is allowed to try
    them on the sample book — that first moment is doing real work at exactly the
    point a stranger decides whether to bother.

    Nothing here rejects. A missing token, a bad one, an expired one or an
    unavailable provider all make the caller a guest, who gets the smaller
    allowance. Turning an expired session into an error would break Explain for
    someone who simply has not opened the app in a while.
    """
    if credentials is None:
        return None

    validator = request.app.state.jwt_validator

    if validator is None:
        return None

    try:
        claims = validator.validate(credentials.credentials)
    except Exception:  # noqa: BLE001 - any failure to identify means "guest"
        return None

    with request.app.state.session_factory() as session:
        return resolve_identity(session, claims)
