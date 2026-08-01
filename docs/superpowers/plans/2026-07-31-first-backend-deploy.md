# First Backend Deploy — Runbook

> **Not an SDD plan.** Unlike other plans in this directory, this is not meant for
> `subagent-driven-development` or `executing-plans` — it's almost entirely actions in
> external dashboards (Supabase, Render) that only you can perform. Follow it yourself,
> in order. The one piece of code it depended on (explicit DB connection-pool sizing)
> was already implemented and committed directly, ahead of this runbook, since it was a
> two-file, two-line change.

**Goal:** Get `backend/app/main.py`'s FastAPI app and `backend/app/worker_main.py`'s
indexing worker running on Render against a Supabase Postgres database, and confirm the
real RN app can use it end-to-end.

**Spec:** `docs/superpowers/specs/2026-07-31-first-backend-deploy-design.md`

**Already done, before you start this runbook:**
- `backend/app/db/session.py` and `backend/app/worker_main.py` now pass explicit
  `pool_size`/`max_overflow` to `create_engine(...)` (small, shared Postgres connection
  budget across both services) — committed already.

---

## Phase 1 — Supabase project

- [ ] **1.1 Create the project.** supabase.com → New Project. Pick a region — ideally
      the same region you'll pick for Render in Phase 2 (both default to US regions;
      matching them keeps DB latency low). Set a strong database password and save it
      somewhere — you'll need it once, to build the connection string.

- [ ] **1.2 Wait for provisioning**, then confirm the project dashboard loads without
      errors.

- [ ] **1.3 Enable `pgvector`.** Dashboard → Database → Extensions → search "vector" →
      enable. (Equivalent SQL, if you prefer the SQL editor instead:
      `create extension if not exists vector;`)

- [ ] **1.4 Get the pooled connection string.** Dashboard → Project Settings →
      Database → Connection string → select **Transaction** mode (this is Supabase's
      Supavisor pooler, port `6543` — not the direct port-`5432` string). It looks like:

  ```
  postgresql://postgres.xxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres
  ```

  Fill in your real password, then **change the scheme** from `postgresql://` to
  `postgresql+psycopg://` — the app's SQLAlchemy setup uses the psycopg3 driver
  explicitly (see `backend/app/config.py`'s `DEFAULT_DATABASE_URL`), and won't resolve a
  bare `postgresql://` URL correctly. Save the edited string — this is your
  `DATABASE_URL` for Phase 2.

  **Verify before moving on:** Dashboard → Database → Connection Pooling should show
  pool mode "Transaction" and confirm the max client connections for your project's
  tier. This is the number from the spec's "connection pooling risk" section — sanity
  check it's comfortably above the ~8 connections the two services can open at once
  (web: 3+2, worker: 2+1).

## Phase 2 — Render services

Both services below use the **same repo, same build command** — only the start command
differs. Root Directory is left blank (repo root) for both, matching how `npm run
backend` / `npm run worker` already invoke these modules locally (`backend` is a real
Python package — see `backend/__init__.py` — so imports only resolve correctly when the
process's working directory is the repo root, not `backend/`).

- [ ] **2.1 Create the web service.** Render dashboard → New → Web Service → connect
      this GitHub repo.
  - Root Directory: *(leave blank)*
  - Build Command: `pip install -r backend/requirements.txt`
  - Start Command: `python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`
  - Instance Type: cheapest **paid** tier (Render's free instances spin down after 15
    min idle and would make every cold request look hung — see the spec)
  - Health Check Path: `/health`
  - Name it `ai-reader-api` (or whatever you prefer — just note it, you'll need the URL
    later)

- [ ] **2.2 Create the background worker.** Render dashboard → New → Background Worker
      → same repo.
  - Root Directory: *(leave blank)*
  - Build Command: `pip install -r backend/requirements.txt`
  - Start Command: `python3 -m backend.app.worker_main`
  - Instance Type: cheapest **paid** tier (background workers aren't available on
    Render's free tier at all)
  - Name it `ai-reader-worker`

- [ ] **2.3 Set environment variables on the web service** (`ai-reader-api` →
      Environment tab). Pull the real values from your local `backend/.env` — nothing
      here is new, it's the same values you already run locally:

  | Key | Value |
  |---|---|
  | `OPENAI_API_KEY` | *(from your local `backend/.env`)* |
  | `OPENAI_MODEL` | *(from your local `backend/.env`)* |
  | `OPENAI_REASONING_EFFORT` | *(from your local `backend/.env`)* |
  | `DATABASE_URL` | *(the edited Supabase pooled string from step 1.4)* |
  | `OIDC_ISSUER_URL` | *(from your local `backend/.env`)* |
  | `OIDC_AUDIENCE` | *(from your local `backend/.env`)* |
  | `OIDC_JWKS_URL` | *(from your local `backend/.env`)* |
  | `OPENAI_EMBEDDING_MODEL` | *(from your local `backend/.env`)* |
  | `OPENAI_EMBEDDING_DIMENSIONS` | *(from your local `backend/.env`)* |
  | `RAG_VECTOR_CANDIDATES` | *(from your local `backend/.env`)* |
  | `RAG_KEYWORD_CANDIDATES` | *(from your local `backend/.env`)* |
  | `RAG_FUSED_CANDIDATES` | *(from your local `backend/.env`)* |
  | `RAG_RRF_K` | *(from your local `backend/.env`)* |
  | `RAG_MIN_VECTOR_SIMILARITY` | *(from your local `backend/.env`)* |
  | `RAG_CONTEXT_MAX_CHARS` | *(from your local `backend/.env`)* |
  | `CORS_ALLOW_ORIGINS` | `*` (unchanged — CORS doesn't constrain the mobile client) |

- [ ] **2.4 Set environment variables on the worker service** (`ai-reader-worker` →
      Environment tab). It only reads a subset (see `backend/app/worker_main.py`'s
      `build_worker`) — setting the rest harmlessly is fine, but the ones it actually
      needs are:

  | Key | Value |
  |---|---|
  | `DATABASE_URL` | *(same edited Supabase pooled string as 2.3)* |
  | `OPENAI_API_KEY` | *(same as 2.3)* |
  | `OPENAI_EMBEDDING_MODEL` | *(same as 2.3)* |
  | `OPENAI_EMBEDDING_DIMENSIONS` | *(same as 2.3)* |

- [ ] **2.5 Deploy both.** Trigger a deploy on each (or let the initial creation deploy
      run). Wait for both to report a live/healthy status in the Render dashboard.

## Phase 3 — Run the migration

- [ ] **3.1 Open a shell on the web service.** Render dashboard → `ai-reader-api` →
      Shell tab.

- [ ] **3.2 Run the migration**, from the shell's working directory (which is the repo
      root, matching Root Directory from 2.1):

  ```bash
  alembic -c backend/alembic.ini upgrade head
  ```

  **What success looks like:** output ending in something like `Running upgrade ... ->
  <revision>, <message>` for each migration file in `backend/alembic/versions/`, with no
  tracebacks. If it fails with a connection error, re-check the `DATABASE_URL` env var
  from step 2.3 for typos (especially the `postgresql+psycopg://` scheme swap from step
  1.4 — this is the most likely mistake).

- [ ] **3.3 Spot-check the schema landed.** Back in the Supabase dashboard → Table
      Editor, confirm you see the app's tables (e.g. `users`, `books`, `index_versions`,
      `rag_chunks`).

## Phase 4 — Verify

- [ ] **4.1 Health check.** From your own machine:

  ```bash
  curl https://<your-ai-reader-api-url>.onrender.com/health
  ```

  Expected: `{"model":"<your OPENAI_MODEL value>","status":"ok"}`. Note this only
  proves the FastAPI process is up — it doesn't touch the database, so it can go green
  even if `DATABASE_URL` is wrong. Real DB connectivity gets proven in step 4.3.

- [ ] **4.2 Confirm the worker is alive.** Render dashboard → `ai-reader-worker` →
      Logs tab. Expect a line like `Worker started: worker-...` (from
      `backend/app/indexing/worker.py`'s `run_forever`) shortly after deploy, with no
      repeating tracebacks.

- [ ] **4.3 Point your local Expo dev client at the deployed backend.** In your local
      `.env` (project root, the one Expo reads — not `backend/.env`), set:

  ```
  EXPO_PUBLIC_API_BASE_URL=https://<your-ai-reader-api-url>.onrender.com
  ```

  Restart the Metro/dev server so the new env var is picked up (`App.tsx` reads
  `process.env.EXPO_PUBLIC_API_BASE_URL` at startup).

- [ ] **4.4 Exercise the real flows against the deployed backend:**
  - Import a book. Watch `ai-reader-worker`'s logs for `Claimed job ... for version
    ...` followed by `Job ... completed successfully` — this is the proof that the
    worker is actually pulling jobs from Supabase, not just idling.
  - Once indexing finishes, try Ask-the-book (a broad question, then a vague
    selection-based follow-up — the exact scenario fixed earlier this session).
  - Try Anki export on a couple of saved notes.

- [ ] **4.5 When you're done verifying**, revert `EXPO_PUBLIC_API_BASE_URL` in your
      local `.env` back to your localhost backend (or unset it) so local development
      keeps working against `npm run backend` as before.

---

## If something's stuck

This is a first deploy — treat any failure as information, not a blocker to push
through. A few likely failure points, given what's actually in the code:

- **Migration fails to connect:** almost always the `DATABASE_URL` scheme (needs
  `postgresql+psycopg://`, not `postgresql://`) or a copy-paste error in the password.
- **Worker logs show repeated `OperationalError` / connection refused:** same
  `DATABASE_URL` check on the worker service specifically — it's a separate env var
  entry from the web service's, easy to typo once and not the other.
- **App can reach `/health` but every real request 500s:** check the web service's
  Render logs for the actual traceback — likely a missing/misnamed env var from the
  table in 2.3 (OIDC values are the easiest to get wrong, since they're not obviously
  wrong until an authenticated request fails).
- **Worker never logs "Claimed job":** confirm the book import actually created an
  `IndexJob` row (Supabase Table Editor → `index_jobs`) — if no row exists, the issue is
  upstream in the web service's upload path, not the worker.

## Before real launch: raise the DB connection pool size

**Do not ship this to real multi-user traffic without revisiting this.** Found live
during this deploy, worth tracking so it isn't forgotten:

`create_session_factory` (`backend/app/db/session.py`) creates its engine — and its
connection pool — exactly once, when the FastAPI app boots (`main.py`'s `create_app`).
That single pool is shared by **every request from every user**, not per-user, not
per-request. Right now it's sized at `pool_size=3, max_overflow=2` (5 connections
total) — deliberately conservative, picked to share a small connection budget with the
worker's own pool against one Supabase instance, before any real usage data existed.

Already proven too small once this session: importing a single book (which fires many
sequential `upload_batch` calls plus status polls) exhausted it and threw
`sqlalchemy.exc.TimeoutError: QueuePool limit of size 3 overflow 2 reached` — that
specific instance was actually a connection-leak bug in `routers/indexing.py` (fixed,
see commit `ae0001c`), but it demonstrated the ceiling is real and easy to hit. Mind map
generation alone can open up to `MAX_EXTRACTION_WORKERS = 8` concurrent DB-touching
threads per run.

With multiple real concurrent users, 5 total connections for the whole app will not be
enough — one user running a mind map generation could stall every other user's request
for up to the 30-second pool timeout.

**What to do before launch:** re-check Supabase's actual max client connections
(confirmed 200 on the free tier during this deploy — see spec's connection-pooling
section) and raise `pool_size`/`max_overflow` on `ai-reader-api`'s engine well above 5,
leaving headroom for the worker's own pool and Supabase's own overhead. There's no
reason to stay this conservative once this is real, not hypothetical, traffic.
