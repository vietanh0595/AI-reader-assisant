from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db.models import ExternalIdentity, User
from .jwt import AuthClaims


def resolve_identity(session: Session, claims: AuthClaims) -> User:
    identity = _find_identity(session, claims)

    if identity is not None:
        if _update_profile(identity, claims):
            session.commit()
        return identity.user

    user = User()
    identity = ExternalIdentity(
        user=user,
        issuer=claims.issuer,
        subject=claims.subject,
        email=claims.email,
        display_name=claims.display_name,
    )
    session.add(identity)

    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        identity = _find_identity(session, claims)

        if identity is None:
            raise

        if _update_profile(identity, claims):
            session.commit()

        return identity.user

    return user


def _find_identity(session: Session, claims: AuthClaims) -> ExternalIdentity | None:
    return session.scalar(
        select(ExternalIdentity).where(
            ExternalIdentity.issuer == claims.issuer,
            ExternalIdentity.subject == claims.subject,
        )
    )


def _update_profile(identity: ExternalIdentity, claims: AuthClaims) -> bool:
    changed = False

    if claims.email is not None and claims.email != identity.email:
        identity.email = claims.email
        changed = True

    if claims.display_name is not None and claims.display_name != identity.display_name:
        identity.display_name = claims.display_name
        changed = True

    return changed
