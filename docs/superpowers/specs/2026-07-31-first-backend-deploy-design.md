# First backend deploy — design

## Goal

Get the backend running somewhere other than a laptop, and confirm the real RN app can
talk to it end-to-end. This is a "prove it works" deploy, not a launch-ready one.

**Explicitly out of scope** (deferred to a later spec): CI/CD auto-deploy, Sentry/error
tracking, a custom domain, a staging environment, an EAS production build profile.

## Architecture

Two Render services plus one Supabase Postgres database. No queue, no message broker —
both services connect to the same `DATABASE_URL` and share the existing DB-backed job
table (`backend/app/indexing/jobs.py`) exactly as they do locally today.

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────────┐
│  Render Web      │      │  Render Worker    │      │  Supabase Postgres  │
│  ai-reader-api   │      │  ai-reader-worker │      │  (free tier)        │
│  uvicorn app.main│      │  worker_main.py   │      │  pgvector enabled   │
└─────────────────┘      └──────────────────┘      └─────────────────────┘
        ▲                        │                            ▲
        │                        └────────────────────────────┘
        │ EXPO_PUBLIC_API_BASE_URL (local dev only, for now)
        │
   RN app (Expo dev client)
```

## Components

- **`ai-reader-api`** (Render web service) — start command `uvicorn app.main:app --host
  0.0.0.0 --port $PORT`, cheapest paid Render instance (no free instance: they spin down
  after 15 min idle). Health check on the existing `GET /health` route.
- **`ai-reader-worker`** (Render background worker) — start command `python -m
  app.worker_main`, cheapest paid Render instance (background workers aren't available
  on Render's free instance tier at all). No public URL, no health check.
- **Supabase Postgres** — new project on Supabase's free tier. `pgvector` extension
  enabled via `create extension if not exists vector;`. `alembic upgrade head` run once
  against it, by hand, before either service is expected to serve real traffic.

Two services rather than one combined process: a slow/stuck indexing job can't starve
API request handling, and deploying/restarting the web service doesn't interrupt
in-progress indexing jobs. Cost tradeoff accepted: roughly two paid instances instead of
one.

## Environment variables

No new variables — every value already exists in `backend/.env.example` /
your local `.env`. This step is relocation, not invention. Each Render service gets its
own copy of the values it needs in the Render dashboard (not committed to git):

- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`
- `DATABASE_URL` — now Supabase's connection string (see Connection pooling below),
  needed by both services
- `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL` — the existing OIDC provider
  already used in local dev, unchanged
- `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_DIMENSIONS`
- `RAG_VECTOR_CANDIDATES`, `RAG_KEYWORD_CANDIDATES`, `RAG_FUSED_CANDIDATES`, `RAG_RRF_K`,
  `RAG_MIN_VECTOR_SIMILARITY`, `RAG_CONTEXT_MAX_CHARS`
- `CORS_ALLOW_ORIGINS` — stays `*`. CORS is enforced by browsers, not mobile clients, so
  this deploy doesn't need it tightened.

The worker only needs `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`,
`OPENAI_EMBEDDING_DIMENSIONS`, and `DATABASE_URL` (see `backend/app/worker_main.py`) —
it doesn't need the OIDC or RAG-tuning vars, though setting them harmlessly is fine too.

## Connection pooling risk

`backend/app/db/session.py`'s `create_session_factory` and
`backend/app/worker_main.py`'s `build_worker` each call `create_engine(...)` with
SQLAlchemy's defaults (`pool_size=5`, `max_overflow=10`). Two long-lived services means
up to ~30 possible simultaneous connections against one free-tier Postgres database.

Mitigation for this deploy:
- Use Supabase's pooled connection string (Supavisor, port 6543, transaction mode) for
  `DATABASE_URL` on both services rather than the direct connection (port 5432).
- Pass explicit, smaller `pool_size`/`max_overflow` into both `create_engine` calls
  instead of relying on SQLAlchemy's defaults, sized to what a single web instance and a
  single worker instance actually need at this stage (a handful of connections each, not
  fifteen).
- Check Supabase's dashboard for the project's actual current connection ceiling before
  treating this as resolved — that number isn't something to assume from memory.

## Rollout / verification steps

1. Create the Supabase project; enable the `pgvector` extension; copy the pooled
   connection string.
2. Create the two Render services; set environment variables on each; deploy.
3. Open a shell on the `ai-reader-api` Render instance; run `alembic upgrade head`
   against the Supabase database.
4. Confirm `GET /health` responds successfully from outside Render.
5. Point a local Expo dev client at the deployed API via `EXPO_PUBLIC_API_BASE_URL` and
   exercise the real flows against it instead of localhost: import a book, wait for
   indexing to finish (confirms the worker is actually picking up jobs from Supabase),
   Ask-the-book, Anki export.

## Explicitly deferred

CI/CD (auto-deploy on push), Sentry/crash reporting, a custom domain, a staging
environment separate from this one, an EAS production build profile pointing a real
TestFlight build at this backend. All of these are real future work, not part of this
spec.
