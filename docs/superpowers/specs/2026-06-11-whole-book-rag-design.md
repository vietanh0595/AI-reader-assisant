# Whole-Book RAG and Indexing Design

## Summary

Add authenticated, opt-in whole-book question answering to the AI reader. Personal books continue to be extracted on-device into the app's existing normalized paragraph blocks. After import, the user can enable whole-book AI, which uploads normalized text and source metadata to FastAPI in resumable batches. A worker creates structure-aware chunks, generates OpenAI embeddings, and stores searchable text and vectors in PostgreSQL with `pgvector`.

The existing inline reading actions remain direct-context interactions. RAG is used only when the user selects the new `Book` Ask scope. Book questions default to content at or before the current reading position, can explicitly include the whole book, and return one to three tappable source references.

## Goals and Boundaries

### Goals

- Answer questions using evidence from an imported EPUB, PDF, or scanned book.
- Preserve paragraph, chapter, page, bounding-box, and reading-order references through indexing and retrieval.
- Prevent spoilers by default with deterministic reading-position filtering.
- Keep indexing resumable, idempotent, retryable, and invisible until a complete index is active.
- Keep storage, retrieval, authentication, and job execution behind provider-neutral interfaces.
- Support immediate deletion of uploaded text and vectors when a book is deleted.

### Out of Scope for V1

- Whole-book or chapter-summary generation.
- Semantic search in the reader's existing Search sheet.
- Cross-device library, note, or reading-progress synchronization.
- Uploading or storing original EPUB, PDF, or image files.
- Incremental chunk-level reindexing of edited books.
- A formal RAG evaluation harness, human-review workflow, or release-quality gate.
- Runtime judge-model verification on every answer.
- LangChain or another orchestration framework.

V1 must still log enough retrieval detail to debug failures and build a later evaluation dataset.

## User Experience

### Authentication

- The bundled sample reader remains usable without an account.
- Sign-in is required before importing a personal book.
- Authentication is supplied by a managed OIDC/JWT provider. The client sends bearer access tokens to FastAPI.
- FastAPI maps token `(issuer, subject)` to an internal `user_id`. Database authorization uses only that internal ID.
- `installation_id` may be recorded for diagnostics and idempotency but is never an ownership or authorization key.
- Initial sign-in methods should support Sign in with Apple, Google, and email magic links through the selected provider.

### Enabling Whole-Book AI

After a personal book is imported, show an `Enable whole-book AI` action with concise disclosure that normalized book text will be uploaded and stored for retrieval. Enabling starts a resumable upload and background index job.

The app exposes these states on the book and in the Ask scope selector:

- `not_enabled`: Book scope unavailable; enable action shown.
- `uploading`: progress based on acknowledged block batches.
- `queued`: upload committed; waiting for a worker.
- `indexing`: worker progress shown.
- `ready`: Book scope enabled.
- `failed`: Book scope disabled with failure message and Retry.
- `deleting`: book hidden from AI actions until backend deletion completes.

### Asking the Book

Extend the existing Ask scope selector to:

```text
Selection | Page | Chapter | Book
```

When `Book` is selected:

- Default retrieval scope is `Book so far`.
- Show an `Include whole book` switch. Enabling it clearly permits later-book content and possible spoilers.
- Disable submission while the index is not `ready` and show the current index status.
- Render the answer in the existing inline insight card.
- Render one to three source links below the answer. Each source shows chapter/page context and a short excerpt, and jumps to the first supporting paragraph when tapped.
- If evidence is insufficient, state that the indexed book does not provide enough support and show the closest sources when available.

### Deletion

- Deleting an indexed book calls the authenticated backend deletion endpoint before completing local deletion.
- On success, delete uploaded blocks, chunks, embeddings, index versions, and jobs in the same backend transaction or deletion workflow.
- If the device is offline or deletion fails, retain the local book and show Retry rather than orphaning cloud content.
- Unindexed local books can still be deleted without a network request.

## Architecture

### Components

1. **Expo reader client**
   - Performs EPUB, PDF, and OCR extraction using existing pipelines.
   - Computes normalized block hashes and the whole-book content hash.
   - Manages resumable upload acknowledgements and local index status.
   - Sends Book questions and opens returned source references.

2. **FastAPI API service**
   - Validates JWTs and resolves `user_id`.
   - Owns upload sessions, indexing status, deletion, Book Ask, and authorization.
   - Never accepts a client-provided owner ID as authoritative.

3. **Indexing worker**
   - Claims durable indexing jobs.
   - Creates chunks, calls OpenAI Embeddings in batches, and upserts vectors.
   - Heartbeats while processing, retries transient failures, and atomically activates complete index versions.

4. **PostgreSQL with pgvector**
   - Stores users, books, normalized uploaded blocks, index versions, jobs, chunks, embeddings, source metadata, and full-text indexes.
   - Is the durable source of truth for job and index status.

5. **OpenAI API**
   - Embeddings API generates chunk and query vectors.
   - Responses API generates the final grounded answer using retrieved evidence.

### Service Boundaries

Keep implementation-specific dependencies behind these interfaces:

- `EmbeddingProvider.embed_documents(texts)` and `embed_query(text)`.
- `RetrievalRepository.store_chunks(...)` and `search(...)`.
- `JobDispatcher.enqueue(job_id)`.
- `JobWorker.claim/heartbeat/complete/fail`.
- `IdentityResolver.resolve(jwt_claims)`.

The first implementation uses the direct OpenAI SDK and PostgreSQL queries. LangChain can be introduced later without changing API contracts if provider or workflow complexity justifies it.

## Data Model

Use UUID primary keys and UTC timestamps. All user-owned tables include or join through `user_id` and are protected by application-level authorization checks.

### Identity

- `users`: internal user record.
- `external_identities`: `user_id`, OIDC issuer, subject, and provider metadata; unique on `(issuer, subject)`.

### Books and Versions

- `books`: `id`, `user_id`, stable client book ID, title, author, source type, filename, active index version ID, created/updated timestamps.
- `index_versions`: `id`, `book_id`, content hash, embedding model, embedding dimensions, chunking version, expected/received block counts, status, progress, error code/message, created/started/completed timestamps.
- Per-user completed `(user_id, content_hash, embedding_model, chunking_version)` may be reused for the same logical book. Private content is never deduplicated across users.

### Uploaded Content

- `book_blocks`: index version ID, paragraph ID, reading order, chapter ID/title, block kind, normalized text, text hash, and `source_ref` JSONB.
- `upload_batches`: index version ID, sequence number, idempotency key, payload hash, block count, and acknowledgement timestamp; unique on `(index_version_id, sequence_number)`.

### Retrieval Content

- `rag_chunks`: index version ID, chunk order, raw chunk text, embedding input text, token count, start/end reading order, chapter ID/title, page start/end, paragraph IDs, source references JSONB, chunk hash, `vector`, and generated PostgreSQL `tsvector`.
- Index vector similarity with pgvector and full-text search with PostgreSQL GIN indexes.

### Jobs

- `index_jobs`: index version ID, status, attempt count, progress, lease owner, lease expiry, heartbeat, next-attempt timestamp, and error details.
- Only one active indexing job is permitted per index version.

## API Contracts

All personal-library endpoints require bearer authentication.

### Create or Resume an Index Upload

`POST /library/books/index`

Request includes client book ID, metadata, content hash, block count, source type, embedding/chunking client schema version, and optional existing cloud book ID.

Response includes cloud book ID, index version ID, current status, highest acknowledged batch, and whether an existing completed index was reused.

### Upload a Batch

`PUT /library/books/{book_id}/index/versions/{version_id}/batches/{sequence}`

- Accept `Content-Encoding: gzip`.
- Accept approximately 100–250 blocks per request while enforcing configured byte, block, and total-book limits.
- Require an idempotency key and payload hash.
- Replaying an identical sequence returns the existing acknowledgement.
- Reusing a sequence with a different payload fails with `409 Conflict`.

Each block contains paragraph ID, text, reading order, block kind, chapter metadata, and source reference.

### Commit Upload

`POST /library/books/{book_id}/index/versions/{version_id}/commit`

Verify ownership, content hash, expected sequence coverage, and received block count. Transition the version to `queued` and create one durable job. Repeated commits are idempotent.

### Status

`GET /library/books/{book_id}/index-status`

Return active version, pending version, status, progress, retryability, and sanitized error information. The app polls while uploading/queued/indexing and backs off when unchanged.

### Retry

`POST /library/books/{book_id}/index/versions/{version_id}/retry`

Allowed only for retryable failed jobs belonging to the authenticated user. It clears the terminal failure state and re-enqueues the same version without duplicating completed chunks.

### Book Ask

`POST /library/books/{book_id}/ask`

Request:

- question
- current paragraph ID and reading-order position
- current chapter ID when known
- `includeWholeBook`, default `false`

Response:

- eyebrow and answer body compatible with the existing insight UI
- `supported` boolean
- one to three sources containing paragraph ID, chapter title, page label/index, excerpt, and source reference
- retrieval request ID for diagnostics

The endpoint returns `409` with index status when no completed active version exists.

### Delete Index

`DELETE /library/books/{book_id}/index`

Delete all server-side content for the authenticated user's book. The endpoint is idempotent and returns success when content is already absent.

## Indexing Pipeline

### Content Hashing and Upload

- Normalize block text exactly as the reader persists it.
- Compute a per-block hash from text, block kind, reading order, chapter metadata, and source reference fields that affect navigation.
- Compute the whole-book content hash from ordered block hashes plus source type and parser schema version.
- Persist upload acknowledgement state in the local library item so network interruption resumes at the first missing sequence.
- Upload only normalized text and metadata; original files remain on-device.

### Chunking Defaults

- Use a tokenizer compatible with the selected embedding model.
- Target 600 tokens, soft minimum 500, and hard maximum 800 tokens.
- Never combine content across chapter boundaries.
- Keep a heading with the following body content and include chapter/section headings in embedding input.
- Permit chunks to span adjacent PDF pages when needed to preserve paragraph continuity; retain page start/end and all source references.
- Overlap by one prior body block, capped at 100 tokens. Do not duplicate standalone headings as overlap.
- Store raw evidence text separately from embedding input text so retrieval metadata does not appear as fabricated book content.
- Version the chunking algorithm. A chunking-version change creates a new index version.

### Embedding Defaults

- Configure embedding model and dimensions through environment settings; initial default is `text-embedding-3-small` with its standard dimensions.
- Batch up to 64 chunk inputs while respecting provider request limits.
- Retry rate limits and transient provider errors with bounded exponential backoff and jitter.
- Upsert by `(index_version_id, chunk_hash)` so retries are idempotent.

### Atomic Activation

- A pending version is never searchable.
- After all expected chunks have vectors and search indexes, mark the version complete and update `books.active_index_version_id` in one transaction.
- A failed rebuild leaves the previous active version unchanged.
- After activation, delete obsolete private versions asynchronously or in bounded batches.

## Job Execution and Deployment

### Local Development

- Run the worker as a separate Python process.
- Poll PostgreSQL and claim eligible jobs using `FOR UPDATE SKIP LOCKED`.
- Use leases and heartbeats so a killed worker's job becomes claimable after expiry.
- Default daily development requires only PostgreSQL/pgvector plus API and worker processes.
- Provide an optional queue-integration Docker profile, such as LocalStack SQS, for testing at-least-once delivery and dead-letter behavior.

### Production Deployment Gate

Before production deployment, replace direct PostgreSQL dispatch with a durable external queue and run workers as a separately scalable service. The provider is intentionally not fixed. Examples include SQS plus ECS/Fargate, a managed Redis queue, RabbitMQ, or another equivalent service selected for cost and operations.

Production queue requirements:

- At-least-once delivery with idempotent workers.
- Visibility/lease renewal for long indexing jobs.
- Bounded retries and a dead-letter queue.
- Queue-depth-based worker autoscaling.
- Transactional outbox or reconciliation so committed PostgreSQL jobs cannot be lost if queue publishing fails.
- Graceful shutdown so workers stop claiming new jobs and release or finish current work.

This production queue migration is mandatory before public launch and must appear in the deployment checklist.

## Retrieval and Answer Generation

### Candidate Retrieval

1. Resolve the authenticated user's active index version.
2. Embed the question.
3. Apply deterministic filters for index version and ownership.
4. Unless `includeWholeBook` is true, require chunk start reading order to be at or before the user's current position and exclude chunks wholly after it.
5. Retrieve up to 30 vector candidates using cosine similarity.
6. Retrieve up to 30 PostgreSQL full-text candidates.
7. Merge rankings with Reciprocal Rank Fusion using initial constant `k=60`.
8. Keep the top 8 fused chunks, then add at most one adjacent chunk on each side when it belongs to the same chapter and passes spoiler filters.
9. Deduplicate overlapping evidence and cap final evidence to the existing assist context budget, initially 18,000 characters.

Do not add a model reranker in V1. Ranking constants and candidate limits remain configuration values for later tuning.

### Weak Evidence and Abstention

- Treat evidence as weak when neither full-text retrieval returns a meaningful match nor the best vector similarity reaches a configurable minimum threshold.
- Pass retrieved evidence and source IDs to a structured answer prompt that may return `supported=false`.
- Instruct the model to use only supplied evidence and to abstain when it cannot support the answer.
- Validate that every returned citation references a retrieved source. Remove invalid citations; if no valid support remains, return the insufficient-evidence response.
- Do not supplement Book answers with general model knowledge in V1.

### Citations

- Select one to three distinct supporting sources, ordered by their first use in the answer.
- Prefer the narrowest useful source: paragraph/block first, with page and chapter shown as navigation context.
- Citation links reuse existing paragraph/source-reference jump behavior.

## Error Handling and Security

- Enforce ownership in every upload, status, ask, retry, and delete query.
- Validate text length, total blocks, total normalized characters, metadata shape, and source-reference size.
- Reject HTML/script payloads as plain text data; never render uploaded text as trusted markup.
- Use TLS in transit and encrypted managed-database storage in production.
- Keep OpenAI and database credentials only on API/worker services.
- Store sanitized user-visible errors and detailed server logs separately.
- Distinguish retryable provider/network failures from permanent validation or authorization failures.
- Apply per-user indexing and Ask rate limits before public launch.
- Avoid logging complete book text or full user questions by default. Log IDs, hashes, scores, timings, model/config versions, statuses, and error classes. Sensitive debugging logs require an explicit protected mode.

## Observability

Record:

- Upload bytes, batches, resume count, and duration.
- Job queue time, processing time, attempts, heartbeat age, chunk count, and embedding usage.
- Ask latency split into query embedding, vector search, full-text search, fusion, generation, and total.
- Retrieved chunk IDs, ranks, scores, citation IDs, index/chunking/embedding/model versions, abstention reason, and request ID.
- Deletion completion and orphan-reconciliation failures.

Formal context precision, recall, faithfulness, human review, and release-gate evaluation are deferred. The logged identifiers must make later replay against a curated evaluation set possible.

## Testing and Acceptance Criteria

### Unit Tests

- Stable block and book hashing.
- Structure-aware chunk boundaries, overlap, token caps, heading handling, and page/chapter source ranges.
- Reciprocal Rank Fusion, spoiler filters, neighbor expansion, deduplication, and context caps.
- JWT identity mapping and ownership-query helpers.
- Citation validation and insufficient-evidence behavior.

### PostgreSQL Integration Tests

- pgvector cosine retrieval and PostgreSQL full-text retrieval.
- Gzip batch ingestion, idempotent replay, conflicting replay, resume, and commit validation.
- `FOR UPDATE SKIP LOCKED` job claims, lease expiry, heartbeat, retry, and single-worker ownership.
- Idempotent embedding upserts and atomic active-version swap.
- Per-user isolation and immediate cascade deletion.

### API Tests

- All personal endpoints reject missing, expired, wrong-audience, and wrong-issuer tokens.
- A user cannot read, ask, retry, or delete another user's book.
- Book Ask rejects non-ready indexes.
- `Book so far` never returns a source wholly after the supplied reading position.
- Whole-book mode may return later sources only when explicitly enabled.
- Returned sources contain valid paragraph IDs and source references.

### End-to-End Acceptance

1. Sign in, import an EPUB or PDF, enable whole-book AI, interrupt upload, resume, and reach `ready`.
2. Ask a paraphrased Book question and receive a grounded answer with tappable sources that jump to the correct passages.
3. Ask an unsupported question and receive an explicit insufficient-evidence response.
4. Reimport identical content and reuse the completed per-user index without new embeddings.
5. Reimport changed content, keep the old index usable during rebuild, then atomically switch.
6. Delete the book and verify all backend content and vectors are gone before local deletion completes.
7. Kill the local worker during indexing and verify the expired lease allows another worker to resume idempotently.

## Implementation Sequence

1. Add managed authentication and backend identity mapping; gate personal imports.
2. Add PostgreSQL/pgvector schema, migrations, configuration, and repositories.
3. Add resumable block upload, commit, status, retry, and deletion APIs.
4. Add the local PostgreSQL-polling worker, chunker, embeddings, and atomic activation.
5. Add hybrid retrieval and Book Ask with citations and abstention.
6. Add the `Book` Ask scope, indexing consent/status UI, resumable client upload state, and source jumps.
7. Add observability, limits, reconciliation, and end-to-end tests.
8. Before production, implement and verify the provider-selected durable queue and separately scalable worker deployment.
