from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from threading import Barrier
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session, sessionmaker

from backend.app.config import OidcSettings


@pytest.fixture(scope="module")
def rsa_private_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_validator(monkeypatch, public_key):
    from backend.app.auth import jwt as auth_jwt

    class FakeJwkClient:
        def __init__(self, jwks_url: str, cache_keys: bool):
            assert jwks_url == "https://login.example.com/.well-known/jwks.json"
            assert cache_keys is True

        def get_signing_key_from_jwt(self, _token: str):
            return SimpleNamespace(key=public_key)

    monkeypatch.setattr(auth_jwt, "PyJWKClient", FakeJwkClient, raising=False)
    return auth_jwt.JwtValidator(
        OidcSettings(
            issuer_url="https://login.example.com/",
            audience="ai-reader-api",
            jwks_url="https://login.example.com/.well-known/jwks.json",
        )
    )


def encode_token(private_key, missing_claim=None, **claim_overrides):
    now = datetime.now(timezone.utc)
    claims = {
        "iss": "https://login.example.com/",
        "sub": "oidc-reader-123",
        "aud": "ai-reader-api",
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "email": "reader@example.com",
        "name": "Test Reader",
    }
    claims.update(claim_overrides)
    if missing_claim is not None:
        claims.pop(missing_claim)
    return jwt.encode(claims, private_key, algorithm="RS256")


@pytest.mark.integration
def test_resolve_identity_reuses_internal_user(db_session):
    from backend.app.auth.jwt import AuthClaims
    from backend.app.auth.repository import resolve_identity

    claims = AuthClaims(
        issuer="https://login.example.com/",
        subject="reader-123",
        email="reader@example.com",
        display_name="Test Reader",
    )

    first_user = resolve_identity(db_session, claims)
    second_user = resolve_identity(db_session, claims)

    assert second_user.id == first_user.id


@pytest.mark.integration
def test_resolve_identity_updates_non_null_profile_claims(db_session):
    from backend.app.auth.jwt import AuthClaims
    from backend.app.auth.repository import resolve_identity
    from backend.app.db.models import ExternalIdentity

    first_user = resolve_identity(
        db_session,
        AuthClaims(
            issuer="https://login.example.com/",
            subject="profile-reader",
            email="old@example.com",
            display_name="Original Name",
        ),
    )
    second_user = resolve_identity(
        db_session,
        AuthClaims(
            issuer="https://login.example.com/",
            subject="profile-reader",
            email="new@example.com",
            display_name=None,
        ),
    )
    identity = db_session.scalar(
        select(ExternalIdentity).where(
            ExternalIdentity.issuer == "https://login.example.com/",
            ExternalIdentity.subject == "profile-reader",
        )
    )

    assert second_user.id == first_user.id
    assert identity is not None
    assert identity.email == "new@example.com"
    assert identity.display_name == "Original Name"


@pytest.mark.integration
def test_resolve_identity_recovers_from_concurrent_first_login(migrated_database):
    from backend.app.auth.jwt import AuthClaims
    from backend.app.auth.repository import resolve_identity
    from backend.app.db.models import ExternalIdentity, User

    session_factory = sessionmaker(bind=migrated_database, expire_on_commit=False)
    flush_barrier = Barrier(2)
    claims = AuthClaims(
        issuer="https://login.example.com/",
        subject=f"concurrent-reader-{uuid4()}",
        email="reader@example.com",
        display_name="Concurrent Reader",
    )

    def resolve_in_parallel() -> object:
        with session_factory() as session:
            def wait_for_other_login(
                _session: Session,
                _flush_context: object,
                _instances: object,
            ) -> None:
                flush_barrier.wait(timeout=5)

            event.listen(session, "before_flush", wait_for_other_login, once=True)
            return resolve_identity(session, claims).id

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            user_ids = list(executor.map(lambda _index: resolve_in_parallel(), range(2)))

        assert user_ids[0] == user_ids[1]
    finally:
        with session_factory.begin() as cleanup_session:
            stored_user_ids = cleanup_session.scalars(
                select(ExternalIdentity.user_id).where(
                    ExternalIdentity.issuer == claims.issuer,
                    ExternalIdentity.subject == claims.subject,
                )
            ).all()
            cleanup_session.execute(delete(User).where(User.id.in_(stored_user_ids)))


def test_jwt_validator_returns_auth_claims(monkeypatch, rsa_private_key):
    from backend.app.auth.jwt import AuthClaims

    validator = make_validator(monkeypatch, rsa_private_key.public_key())

    claims = validator.validate(encode_token(rsa_private_key))

    assert claims == AuthClaims(
        issuer="https://login.example.com/",
        subject="oidc-reader-123",
        email="reader@example.com",
        display_name="Test Reader",
    )


def test_jwt_validator_rejects_wrong_issuer(monkeypatch, rsa_private_key):
    from backend.app.auth.jwt import InvalidAuthTokenError

    validator = make_validator(monkeypatch, rsa_private_key.public_key())
    token = encode_token(rsa_private_key, iss="https://attacker.example.com/")

    with pytest.raises(InvalidAuthTokenError):
        validator.validate(token)


def test_jwt_validator_rejects_wrong_audience(monkeypatch, rsa_private_key):
    from backend.app.auth.jwt import InvalidAuthTokenError

    validator = make_validator(monkeypatch, rsa_private_key.public_key())
    token = encode_token(rsa_private_key, aud="different-api")

    with pytest.raises(InvalidAuthTokenError):
        validator.validate(token)


def test_jwt_validator_rejects_expired_token(monkeypatch, rsa_private_key):
    from backend.app.auth.jwt import InvalidAuthTokenError

    validator = make_validator(monkeypatch, rsa_private_key.public_key())
    token = encode_token(
        rsa_private_key,
        exp=datetime.now(timezone.utc) - timedelta(seconds=1),
    )

    with pytest.raises(InvalidAuthTokenError):
        validator.validate(token)


def test_jwt_validator_rejects_invalid_signature(monkeypatch, rsa_private_key):
    from backend.app.auth.jwt import InvalidAuthTokenError

    different_private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    validator = make_validator(monkeypatch, rsa_private_key.public_key())
    token = encode_token(different_private_key)

    with pytest.raises(InvalidAuthTokenError):
        validator.validate(token)


def test_jwt_validator_requires_standard_oidc_claims(monkeypatch, rsa_private_key):
    from backend.app.auth.jwt import InvalidAuthTokenError

    validator = make_validator(monkeypatch, rsa_private_key.public_key())
    token = encode_token(rsa_private_key, missing_claim="iat")

    with pytest.raises(InvalidAuthTokenError):
        validator.validate(token)


def test_auth_me_requires_bearer_token(test_client):
    response = test_client.get("/auth/me")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_auth_me_reports_unconfigured_sign_in(test_client):
    response = test_client.get(
        "/auth/me",
        headers={"Authorization": "Bearer local-test-token"},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "Sign-in is not configured."}


def test_auth_me_returns_internal_user_id(test_app, test_client):
    from backend.app.auth.dependencies import get_current_user
    from backend.app.db.models import User

    user_id = uuid4()
    test_app.dependency_overrides[get_current_user] = lambda: User(id=user_id)

    try:
        response = test_client.get("/auth/me")
    finally:
        test_app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"userId": str(user_id)}


def test_auth_me_normalizes_invalid_token_errors(test_app, test_client):
    from backend.app.auth.jwt import InvalidAuthTokenError

    class RejectingValidator:
        def validate(self, _token: str):
            raise InvalidAuthTokenError("sensitive token details")

    test_app.state.jwt_validator = RejectingValidator()

    response = test_client.get(
        "/auth/me",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json() == {"detail": "Invalid authentication credentials."}


@pytest.mark.integration
def test_auth_me_resolves_claims_to_internal_user(
    test_app,
    test_client,
    migrated_database,
):
    from backend.app.auth.jwt import AuthClaims
    from backend.app.db.models import ExternalIdentity, User

    claims = AuthClaims(
        issuer="https://login.example.com/",
        subject="dependency-reader",
        email="dependency@example.com",
        display_name="Dependency Reader",
    )

    class AcceptingValidator:
        def validate(self, token: str):
            assert token == "valid-test-token"
            return claims

    session_factory = sessionmaker(bind=migrated_database, expire_on_commit=False)
    test_app.state.jwt_validator = AcceptingValidator()
    test_app.state.session_factory = session_factory

    try:
        response = test_client.get(
            "/auth/me",
            headers={"Authorization": "Bearer valid-test-token"},
        )
        with Session(migrated_database) as observer:
            identity = observer.scalar(
                select(ExternalIdentity).where(
                    ExternalIdentity.issuer == claims.issuer,
                    ExternalIdentity.subject == claims.subject,
                )
            )

        assert response.status_code == 200
        assert identity is not None
        assert response.json() == {"userId": str(identity.user_id)}
    finally:
        with session_factory.begin() as cleanup_session:
            stored_user_ids = cleanup_session.scalars(
                select(ExternalIdentity.user_id).where(
                    ExternalIdentity.issuer == claims.issuer,
                    ExternalIdentity.subject == claims.subject,
                )
            ).all()
            cleanup_session.execute(delete(User).where(User.id.in_(stored_user_ids)))


def test_create_app_rejects_partial_oidc_configuration(app_settings):
    from backend.app.main import create_app

    partial_settings = replace(
        app_settings,
        oidc_issuer_url="https://login.example.com/",
    )

    with pytest.raises(RuntimeError, match="OIDC settings must be configured together"):
        create_app(partial_settings)


def test_create_app_constructs_validator_for_complete_oidc_settings(
    app_settings,
    monkeypatch,
):
    from backend.app import main

    captured_settings = []

    class FakeJwtValidator:
        def __init__(self, settings):
            captured_settings.append(settings)

    monkeypatch.setattr(main, "JwtValidator", FakeJwtValidator, raising=False)
    configured_settings = replace(
        app_settings,
        oidc_issuer_url="https://login.example.com/",
        oidc_audience="ai-reader-api",
        oidc_jwks_url="https://login.example.com/.well-known/jwks.json",
    )

    configured_app = main.create_app(configured_settings)

    assert isinstance(configured_app.state.jwt_validator, FakeJwtValidator)
    assert len(captured_settings) == 1
    assert captured_settings[0] == configured_settings.require_oidc_settings()
