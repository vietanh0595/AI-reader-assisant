# RAG Foundation, Authentication, and Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the test harness, PostgreSQL/pgvector foundation, provider-neutral OIDC authentication, and mandatory sign-in gate for personal imports.

**Architecture:** Keep the sample book public while routing all personal-library cloud operations through an authenticated API client. FastAPI validates standards-based JWTs, maps `(issuer, subject)` to an internal user, and persists identity records through SQLAlchemy. The Expo client uses Authorization Code + PKCE against a hosted OIDC login and stores refresh credentials in SecureStore.

**Tech Stack:** Expo 54, React Native, TypeScript, `expo-auth-session`, `expo-secure-store`, FastAPI, PyJWT, SQLAlchemy 2, Alembic, PostgreSQL 16, pgvector, pytest, Jest Expo

**Prerequisite:** Read `docs/superpowers/specs/2026-06-11-whole-book-rag-design.md`. Execute this plan before the indexing and Book Q&A plans.

---

## File Map

**Backend foundation**

- Create `backend/app/db/base.py`: SQLAlchemy declarative base and shared timestamp mixin.
- Create `backend/app/db/session.py`: engine, session factory, FastAPI dependency, and transaction helper.
- Create `backend/app/db/models.py`: `User` and `ExternalIdentity` models in this phase.
- Create `backend/app/auth/jwt.py`: OIDC discovery/JWKS token validation.
- Create `backend/app/auth/dependencies.py`: authenticated-user FastAPI dependency.
- Create `backend/app/auth/repository.py`: identity-to-user resolution.
- Create `backend/app/auth/schemas.py`: `/auth/me` response contract.
- Create `backend/app/routers/auth.py`: authenticated identity endpoint.
- Create `backend/alembic.ini`, `backend/alembic/env.py`, and initial migration.
- Create `backend/tests/`: backend unit and integration tests.
- Modify `backend/app/config.py`: database and OIDC settings.
- Modify `backend/app/main.py`: app factory, database dependency wiring, and auth router.
- Modify `backend/requirements.txt`: database, auth, migration, and test dependencies.

**Client foundation**

- Create `src/auth/config.ts`: validated public OIDC configuration.
- Create `src/auth/AuthProvider.tsx`: PKCE login, refresh, logout, and token state.
- Create `src/auth/types.ts`: session and auth-context contracts.
- Create `src/api/client.ts`: authenticated JSON and binary request helpers.
- Create `src/components/SignInSheet.tsx`: hosted-login entry point.
- Modify `App.tsx:2305-3235`: wrap reader in auth context and gate personal import/scan.
- Modify `package.json`: auth dependencies and frontend test scripts.
- Create `jest.config.js` and `src/**/*.test.ts(x)`: client tests.

**Local operations**

- Create `compose.yaml`: local pgvector database and isolated test database.
- Modify `.env.example` and `backend/.env.example`: OIDC/database variables without secrets.
- Modify `README.md`: exact startup, migration, and test commands.

### Task 1: Add Backend Test and Configuration Foundations

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/config.py:12-66`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_config.py`
- Create: `backend/pytest.ini`

- [ ] **Step 1: Write failing settings tests**

```python
# backend/tests/test_config.py
from backend.app.config import Settings


def test_settings_reads_database_and_oidc(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://reader:reader@localhost:5432/reader")
    monkeypatch.setenv("OIDC_ISSUER_URL", "https://login.example.com/")
    monkeypatch.setenv("OIDC_AUDIENCE", "ai-reader-api")
    monkeypatch.setenv("OIDC_JWKS_URL", "https://login.example.com/.well-known/jwks.json")

    settings = Settings.from_env()

    assert settings.database_url.endswith("/reader")
    assert settings.oidc_issuer_url == "https://login.example.com/"
    assert settings.oidc_audience == "ai-reader-api"
    assert settings.oidc_jwks_url.endswith("jwks.json")


def test_require_auth_settings_reports_missing_values(monkeypatch):
    for name in ("OIDC_ISSUER_URL", "OIDC_AUDIENCE", "OIDC_JWKS_URL"):
        monkeypatch.delenv(name, raising=False)

    settings = Settings.from_env()

    try:
        settings.require_oidc_settings()
    except RuntimeError as exc:
        assert "OIDC_ISSUER_URL" in str(exc)
    else:
        raise AssertionError("Expected missing OIDC settings to fail")
```

- [ ] **Step 2: Run the tests and verify the new fields are missing**

Run: `source .venv/bin/activate && pytest -c backend/pytest.ini backend/tests/test_config.py -v`

Expected: FAIL because `Settings` has no `database_url` or OIDC fields.

- [ ] **Step 3: Add dependencies and settings**

Add these dependencies to `backend/requirements.txt`:

```text
alembic>=1.16.0
httpx>=0.28.0
pgvector>=0.4.0
psycopg[binary]>=3.2.0
PyJWT[crypto]>=2.10.0
pytest>=8.4.0
sqlalchemy>=2.0.40
```

Extend `Settings` in `backend/app/config.py`:

```python
DEFAULT_DATABASE_URL = "postgresql+psycopg://reader:reader@localhost:5432/reader"


@dataclass(frozen=True)
class OidcSettings:
    issuer_url: str
    audience: str
    jwks_url: str


@dataclass(frozen=True)
class Settings:
    openai_api_key: Optional[str]
    openai_model: str
    openai_reasoning_effort: Optional[str]
    cors_allow_origins: tuple[str, ...]
    database_url: str
    oidc_issuer_url: Optional[str]
    oidc_audience: Optional[str]
    oidc_jwks_url: Optional[str]

    @classmethod
    def from_env(cls) -> "Settings":
        load_project_env_files()
        return cls(
            openai_api_key=_read_optional_env("OPENAI_API_KEY"),
            openai_model=os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL).strip() or DEFAULT_OPENAI_MODEL,
            openai_reasoning_effort=_read_optional_env("OPENAI_REASONING_EFFORT") or DEFAULT_REASONING_EFFORT,
            cors_allow_origins=_read_cors_origins(),
            database_url=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL).strip() or DEFAULT_DATABASE_URL,
            oidc_issuer_url=_read_optional_env("OIDC_ISSUER_URL"),
            oidc_audience=_read_optional_env("OIDC_AUDIENCE"),
            oidc_jwks_url=_read_optional_env("OIDC_JWKS_URL"),
        )

    def require_oidc_settings(self) -> OidcSettings:
        missing = [
            name
            for name, value in (
                ("OIDC_ISSUER_URL", self.oidc_issuer_url),
                ("OIDC_AUDIENCE", self.oidc_audience),
                ("OIDC_JWKS_URL", self.oidc_jwks_url),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing required OIDC settings: {', '.join(missing)}")
        return OidcSettings(
            issuer_url=self.oidc_issuer_url,
            audience=self.oidc_audience,
            jwks_url=self.oidc_jwks_url,
        )
```

Create `backend/pytest.ini`:

```ini
[pytest]
pythonpath = ..
testpaths = tests
```

- [ ] **Step 4: Run configuration tests**

Run: `source .venv/bin/activate && python -m pip install -r backend/requirements.txt && pytest -c backend/pytest.ini backend/tests/test_config.py -v`

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/config.py backend/tests backend/pytest.ini
git commit -m "test: add backend configuration harness"
```

### Task 2: Add PostgreSQL, pgvector, SQLAlchemy, and Alembic

**Files:**
- Create: `compose.yaml`
- Create: `backend/app/db/__init__.py`
- Create: `backend/app/db/base.py`
- Create: `backend/app/db/session.py`
- Create: `backend/app/db/models.py`
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/versions/20260611_0001_identity.py`
- Create: `backend/tests/integration/test_identity_models.py`

- [ ] **Step 1: Write the failing identity persistence test**

```python
# backend/tests/integration/test_identity_models.py
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
```

- [ ] **Step 2: Start PostgreSQL and verify the test fails before models exist**

Create `compose.yaml` first so the failure is about missing code, not infrastructure:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: reader
      POSTGRES_PASSWORD: reader
      POSTGRES_USER: reader
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U reader -d reader"]
      interval: 2s
      timeout: 3s
      retries: 20
    volumes:
      - reader-postgres:/var/lib/postgresql/data

  postgres-test:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: reader_test
      POSTGRES_PASSWORD: reader
      POSTGRES_USER: reader
    ports:
      - "127.0.0.1:5433:5432"
    profiles: ["test"]

volumes:
  reader-postgres:
```

Run:

```bash
docker compose --profile test up -d postgres-test
TEST_DATABASE_URL=postgresql+psycopg://reader:reader@localhost:5433/reader_test pytest -c backend/pytest.ini backend/tests/integration/test_identity_models.py -v
```

Expected: FAIL because database modules and fixtures do not exist.

- [ ] **Step 3: Add SQLAlchemy base, sessions, models, and test fixture**

```python
# backend/app/db/base.py
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class UuidTimestampMixin:
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

```python
# backend/app/db/session.py
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from ..config import Settings


def create_session_factory(settings: Settings) -> sessionmaker[Session]:
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    return sessionmaker(bind=engine, expire_on_commit=False)


def session_dependency(factory: sessionmaker[Session]):
    def get_session() -> Generator[Session, None, None]:
        with factory() as session:
            yield session
    return get_session
```

```python
# backend/app/db/models.py
from typing import Optional
from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UuidTimestampMixin


class User(UuidTimestampMixin, Base):
    __tablename__ = "users"
    identities: Mapped[list["ExternalIdentity"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class ExternalIdentity(UuidTimestampMixin, Base):
    __tablename__ = "external_identities"
    __table_args__ = (UniqueConstraint("issuer", "subject", name="uq_identity_issuer_subject"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    issuer: Mapped[str] = mapped_column(String(500))
    subject: Mapped[str] = mapped_column(String(500))
    email: Mapped[Optional[str]] = mapped_column(String(320))
    display_name: Mapped[Optional[str]] = mapped_column(String(200))
    user: Mapped[User] = relationship(back_populates="identities")
```

Add `db_session` in `backend/tests/conftest.py` using `TEST_DATABASE_URL`. Prepare the session-scoped test database with `alembic upgrade head`, then wrap each test in an outer connection transaction so test-level commits are rolled back during fixture cleanup.

- [ ] **Step 4: Add Alembic migration with pgvector enabled**

The initial migration must execute:

```python
def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "external_identities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issuer", sa.String(500), nullable=False),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("email", sa.String(320)),
        sa.Column("display_name", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("issuer", "subject", name="uq_identity_issuer_subject"),
    )
    op.create_index("ix_external_identities_user_id", "external_identities", ["user_id"])
```

- [ ] **Step 5: Run migration and integration test**

Run:

```bash
DATABASE_URL=postgresql+psycopg://reader:reader@localhost:5432/reader alembic -c backend/alembic.ini upgrade head
TEST_DATABASE_URL=postgresql+psycopg://reader:reader@localhost:5433/reader_test pytest -c backend/pytest.ini backend/tests/integration/test_identity_models.py -v
```

Expected: migration succeeds and all 8 integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add compose.yaml backend/app/db backend/alembic.ini backend/alembic backend/tests/conftest.py backend/tests/integration
git commit -m "feat: add postgres identity foundation"
```

### Task 3: Validate OIDC JWTs and Resolve Internal Users

**Files:**
- Create: `backend/app/auth/__init__.py`
- Create: `backend/app/auth/jwt.py`
- Create: `backend/app/auth/repository.py`
- Create: `backend/app/auth/dependencies.py`
- Create: `backend/app/auth/schemas.py`
- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/routers/auth.py`
- Modify: `backend/app/main.py:12-56`
- Create: `backend/tests/test_auth.py`

- [ ] **Step 1: Write failing JWT and ownership identity tests**

```python
# backend/tests/test_auth.py
from uuid import uuid4

from backend.app.auth.jwt import AuthClaims
from backend.app.auth.repository import resolve_identity


def test_resolve_identity_reuses_issuer_subject(db_session):
    claims = AuthClaims(
        issuer="https://login.example.com/",
        subject="subject-123",
        email="reader@example.com",
        display_name="Reader",
    )

    first = resolve_identity(db_session, claims)
    second = resolve_identity(db_session, claims)

    assert first.id == second.id


def test_auth_me_rejects_missing_bearer(client):
    response = client.get("/auth/me")
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/test_auth.py -v`

Expected: FAIL because auth modules and `/auth/me` do not exist.

- [ ] **Step 3: Implement JWT validation**

```python
# backend/app/auth/jwt.py
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

from ..config import OidcSettings


@dataclass(frozen=True)
class AuthClaims:
    issuer: str
    subject: str
    email: str | None
    display_name: str | None


class JwtValidator:
    def __init__(self, settings: OidcSettings):
        self._settings = settings
        self._jwks = PyJWKClient(settings.jwks_url, cache_keys=True)

    def validate(self, token: str) -> AuthClaims:
        signing_key = self._jwks.get_signing_key_from_jwt(token).key
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256", "ES256"],
            audience=self._settings.audience,
            issuer=self._settings.issuer_url,
            options={"require": ["exp", "iat", "iss", "sub"]},
        )
        return AuthClaims(
            issuer=payload["iss"],
            subject=payload["sub"],
            email=payload.get("email"),
            display_name=payload.get("name"),
        )
```

- [ ] **Step 4: Implement identity resolution and FastAPI dependency**

```python
# backend/app/auth/repository.py
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import ExternalIdentity, User
from .jwt import AuthClaims


def resolve_identity(session: Session, claims: AuthClaims) -> User:
    identity = session.scalar(
        select(ExternalIdentity).where(
            ExternalIdentity.issuer == claims.issuer,
            ExternalIdentity.subject == claims.subject,
        )
    )
    if identity:
        return identity.user

    user = User()
    session.add(user)
    session.flush()
    session.add(
        ExternalIdentity(
            user_id=user.id,
            issuer=claims.issuer,
            subject=claims.subject,
            email=claims.email,
            display_name=claims.display_name,
        )
    )
    session.commit()
    return user
```

`backend/app/auth/dependencies.py` must use `HTTPBearer(auto_error=False)`, return `401` for missing/invalid tokens, validate with `JwtValidator`, and call `resolve_identity`. Tests override this dependency with a fixed `User` instead of generating real provider tokens.

- [ ] **Step 5: Add `/auth/me` and an app factory**

Refactor `backend/app/main.py` to expose `create_app(settings: Settings | None = None) -> FastAPI`, construct the session factory once, construct the validator only when all OIDC settings exist, attach both to `app.state`, and include `backend/app/routers/auth.py`. Health, OCR, and public sample assist routes must still start without OIDC configuration; authenticated dependencies return `503 Sign-in is not configured.` until OIDC settings are present.

```python
# backend/app/routers/auth.py
from fastapi import APIRouter, Depends

from ..auth.dependencies import get_current_user
from ..auth.schemas import CurrentUserResponse
from ..db.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=CurrentUserResponse)
def me(user: User = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(userId=str(user.id))
```

- [ ] **Step 6: Run backend tests**

Run: `pytest -c backend/pytest.ini backend/tests -v`

Expected: all unit and identity integration tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/auth backend/app/routers backend/app/main.py backend/tests
git commit -m "feat: authenticate oidc users"
```

### Task 4: Add the Expo OIDC Session and Authenticated API Client

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`
- Create: `src/auth/config.ts`
- Create: `src/auth/types.ts`
- Create: `src/auth/tokenStore.ts`
- Create: `src/auth/AuthProvider.tsx`
- Create: `src/api/client.ts`
- Create: `src/api/client.test.ts`

- [ ] **Step 1: Install Expo-compatible auth and test packages**

Run:

```bash
npx expo install expo-auth-session expo-crypto expo-secure-store
npx expo install --dev jest-expo @testing-library/react-native @types/jest
```

Add scripts:

```json
{
  "scripts": {
    "test": "jest --runInBand",
    "test:watch": "jest --watch"
  }
}
```

Create `jest.config.js`:

```javascript
module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/backend/'],
};
```

- [ ] **Step 2: Write a failing authenticated-client test**

```typescript
// src/api/client.test.ts
import { createApiClient } from './client';

test('adds the current bearer token', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ userId: 'user-1' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }),
  );
  const client = createApiClient('http://localhost:8000', async () => 'token-1', fetchImpl);

  await client.json('/auth/me');

  expect(fetchImpl).toHaveBeenCalledWith(
    'http://localhost:8000/auth/me',
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }),
  );
});
```

- [ ] **Step 3: Run the client test and verify failure**

Run: `npm test -- src/api/client.test.ts`

Expected: FAIL because `createApiClient` does not exist.

- [ ] **Step 4: Implement OIDC config and token storage**

```typescript
// src/auth/config.ts
export type OidcClientConfig = {
  audience: string;
  clientId: string;
  issuerUrl: string;
  scopes: string[];
};

export function getOidcClientConfig(): OidcClientConfig | null {
  const issuerUrl = process.env.EXPO_PUBLIC_OIDC_ISSUER_URL?.trim();
  const clientId = process.env.EXPO_PUBLIC_OIDC_CLIENT_ID?.trim();
  const audience = process.env.EXPO_PUBLIC_OIDC_AUDIENCE?.trim();
  if (!issuerUrl || !clientId || !audience) {
    return null;
  }
  return { audience, clientId, issuerUrl, scopes: ['openid', 'profile', 'email', 'offline_access'] };
}
```

`src/auth/tokenStore.ts` stores only the serialized refresh/access token response under `ai-reader-auth-session` using `SecureStore.setItemAsync`, reads it on startup, and deletes it on logout.

- [ ] **Step 5: Implement Authorization Code + PKCE provider**

When configuration exists, `AuthProvider` must use `useAutoDiscovery`, `useAuthRequest` with `ResponseType.Code`, `usePKCE: true`, and `makeRedirectUri({ scheme: 'aibookreader' })`. On a successful code response, call `exchangeCodeAsync`; before returning a token, refresh when `TokenResponse.isTokenFresh()` is false. When configuration is absent, the provider still renders the public sample and `signIn()` reports `Sign-in is not configured on this build.` Expose this exact context:

```typescript
export type AuthContextValue = {
  accessToken: string | null;
  getAccessToken: () => Promise<string | null>;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};
```

The hosted OIDC login is responsible for Apple, Google, and email magic-link choices; the app does not build three separate credential forms.

- [ ] **Step 6: Implement the authenticated API client**

```typescript
// src/api/client.ts
type TokenGetter = () => Promise<string | null>;

export function createApiClient(baseUrl: string, getToken: TokenGetter, fetchImpl: typeof fetch = fetch) {
  async function request(path: string, init: RequestInit = {}) {
    const token = await getToken();
    if (!token) throw new Error('Sign in is required.');
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Request failed with status ${response.status}.`);
    }
    return response;
  }

  return {
    json: async <T>(path: string, init?: RequestInit): Promise<T> =>
      (await request(path, init)).json() as Promise<T>,
    request,
  };
}
```

- [ ] **Step 7: Run client tests and typecheck**

Run: `npm test -- src/api/client.test.ts && npm run typecheck`

Expected: test passes and TypeScript reports no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json jest.config.js src/auth src/api
git commit -m "feat: add oidc client session"
```

### Task 5: Gate Personal Imports Behind Sign-In

**Files:**
- Create: `src/components/SignInSheet.tsx`
- Create: `src/components/SignInSheet.test.tsx`
- Modify: `App.tsx:2305-3235`
- Modify: `app.json`

- [ ] **Step 1: Write the failing sign-in sheet test**

```typescript
// src/components/SignInSheet.test.tsx
import { fireEvent, render } from '@testing-library/react-native';
import { SignInSheet } from './SignInSheet';

test('starts hosted sign-in', () => {
  const onSignIn = jest.fn();
  const screen = render(<SignInSheet error={null} isLoading={false} onClose={jest.fn()} onSignIn={onSignIn} />);
  fireEvent.press(screen.getByRole('button', { name: 'Continue to sign in' }));
  expect(onSignIn).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- src/components/SignInSheet.test.tsx`

Expected: FAIL because `SignInSheet` does not exist.

- [ ] **Step 3: Build the sign-in sheet**

The sheet contains a title, a short statement that an account is required for personal books, one `Continue to sign in` command, a close icon, loading state, and error text. It must not describe individual provider mechanics because those choices appear on the hosted login page.

```typescript
export type SignInSheetProps = {
  error: string | null;
  isLoading: boolean;
  onClose: () => void;
  onSignIn: () => void;
};
```

- [ ] **Step 4: Wrap the reader with authentication**

Rename the existing component to `ReaderApp`, then export a wrapper:

```typescript
function ReaderApp() {
  // Existing App body plus useAuth().
}

export default function App() {
  return (
    <AuthProvider>
      <ReaderApp />
    </AuthProvider>
  );
}
```

Set `scheme` in `app.json`:

```json
{
  "expo": {
    "scheme": "aibookreader"
  }
}
```

- [ ] **Step 5: Gate imports and scans without blocking the sample**

Add `pendingAuthenticatedAction: 'import' | 'scan' | null`. At the start of both `importBook()` and `scanDocumentPage()`, when `isAuthenticated` is false, set the pending action, open `SignInSheet`, and return before document/camera permission prompts. After successful sign-in, close the sheet and invoke the pending action exactly once. Reading, selection actions, and page summary on the bundled sample remain available while signed out.

- [ ] **Step 6: Add account controls**

Add a small account icon to `LibraryScreen` header. Signed-out state opens `SignInSheet`; signed-in state shows a compact menu with `Sign out`. Signing out does not delete local books, but authenticated cloud operations fail closed until sign-in resumes.

- [ ] **Step 7: Run client verification**

Run: `npm test && npm run typecheck && npx expo export --platform web`

Expected: all Jest tests pass, typecheck succeeds, and web export completes.

- [ ] **Step 8: Commit**

```bash
git add App.tsx app.json src/components
git commit -m "feat: require sign in for personal imports"
```

### Task 6: Document and Verify the Foundation

**Files:**
- Create: `.env.example`
- Modify: `backend/.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add non-secret environment templates**

Root `.env.example`:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.10:8000
EXPO_PUBLIC_OIDC_ISSUER_URL=https://your-tenant.example.com/
EXPO_PUBLIC_OIDC_CLIENT_ID=your_native_client_id
EXPO_PUBLIC_OIDC_AUDIENCE=ai-reader-api
```

Backend additions:

```env
DATABASE_URL=postgresql+psycopg://reader:reader@localhost:5432/reader
OIDC_ISSUER_URL=https://your-tenant.example.com/
OIDC_AUDIENCE=ai-reader-api
OIDC_JWKS_URL=https://your-tenant.example.com/.well-known/jwks.json
```

- [ ] **Step 2: Add exact local commands to README**

Document:

```bash
docker compose up -d postgres
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
alembic -c backend/alembic.ini upgrade head
npm run backend
npm start -- --port 8081
```

Also document `pytest -c backend/pytest.ini backend/tests -v`, `npm test`, `npm run typecheck`, and the provider callback URL generated by `aibookreader://`.

- [ ] **Step 3: Run the complete foundation verification**

Run:

```bash
pytest -c backend/pytest.ini backend/tests -v
npm test
npm run typecheck
npx expo export --platform web
curl http://localhost:8000/health
```

Expected: tests and export pass; health returns `{"model":"gpt-5-mini","status":"ok"}`.

- [ ] **Step 4: Commit**

```bash
git add .env.example backend/.env.example README.md
git commit -m "docs: add authenticated local setup"
```

## Phase Acceptance

- The sample reader opens without authentication.
- Import and Scan open hosted sign-in before accessing personal files or camera.
- A valid OIDC access token creates or reuses one internal user by `(issuer, subject)`.
- `/auth/me` rejects missing, expired, wrong-issuer, and wrong-audience tokens.
- PostgreSQL starts through Docker and Alembic enables pgvector.
- Backend tests, Jest, TypeScript, and Expo web export pass.
