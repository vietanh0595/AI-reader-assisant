from uuid import UUID

import pytest
from sqlalchemy import Connection, delete, inspect, select, text
from sqlalchemy.exc import IntegrityError

from backend.app.db.models import ExternalIdentity, User


pytestmark = pytest.mark.integration


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


def test_database_is_prepared_by_alembic(db_session):
    inspector = inspect(db_session.connection())

    assert "alembic_version" in inspector.get_table_names()
    assert (
        db_session.scalar(text("SELECT version_num FROM alembic_version"))
        == "20260611_0002"
    )


def test_vector_extension_exists(db_session):
    installed = db_session.scalar(
        text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')")
    )

    assert installed is True


def test_duplicate_issuer_subject_is_rejected(db_session):
    user = User()
    db_session.add(user)
    db_session.flush()
    db_session.add(
        ExternalIdentity(
            user_id=user.id,
            issuer="https://login.example.com/",
            subject="duplicate-subject",
        )
    )
    db_session.commit()
    db_session.add(
        ExternalIdentity(
            user_id=user.id,
            issuer="https://login.example.com/",
            subject="duplicate-subject",
        )
    )

    with pytest.raises(IntegrityError):
        db_session.flush()


def test_deleting_user_cascades_external_identity(db_session):
    user = User()
    identity = ExternalIdentity(
        user=user,
        issuer="https://login.example.com/",
        subject="cascade-subject",
    )
    db_session.add(identity)
    db_session.commit()
    identity_id = identity.id

    db_session.execute(delete(User).where(User.id == user.id))
    db_session.commit()
    db_session.expire_all()

    assert db_session.get(ExternalIdentity, identity_id) is None


def test_uuid_and_timestamps_populate(db_session):
    user = User()
    db_session.add(user)
    db_session.flush()

    assert isinstance(user.id, UUID)
    assert user.created_at.tzinfo is not None
    assert user.updated_at.tzinfo is not None


def test_identity_schema_has_expected_index_and_unique_constraint(db_session):
    inspector = inspect(db_session.connection())
    indexes = {
        index["name"]: index
        for index in inspector.get_indexes("external_identities")
    }
    unique_constraints = {
        constraint["name"]: constraint
        for constraint in inspector.get_unique_constraints("external_identities")
    }

    assert indexes["ix_external_identities_user_id"]["column_names"] == ["user_id"]
    assert unique_constraints["uq_identity_issuer_subject"]["column_names"] == [
        "issuer",
        "subject",
    ]


def test_session_commit_stays_inside_outer_test_transaction(
    db_session,
    migrated_database,
):
    user = User()
    db_session.add(user)
    db_session.commit()

    bind = db_session.get_bind()
    assert isinstance(bind, Connection)
    assert bind.in_transaction()

    with migrated_database.connect() as observer:
        assert observer.scalar(select(User.id).where(User.id == user.id)) is None
