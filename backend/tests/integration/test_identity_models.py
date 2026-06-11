from sqlalchemy import select

from backend.app.db.models import ExternalIdentity, User


def test_identity_belongs_to_internal_user(db_session):
    user = User()
    db_session.add(user)
    db_session.flush()
    identity = ExternalIdentity(
        user_id=user.id,
        issuer="https://login.example.com/",
        subject="oidc-user-1",
        email="reader@example.com",
    )
    db_session.add(identity)
    db_session.commit()

    stored = db_session.scalar(
        select(ExternalIdentity).where(
            ExternalIdentity.issuer == "https://login.example.com/",
            ExternalIdentity.subject == "oidc-user-1",
        )
    )

    assert stored is not None
    assert stored.user_id == user.id
