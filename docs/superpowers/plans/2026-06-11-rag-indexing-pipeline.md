# Whole-Book Indexing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload normalized book blocks resumably, build structure-aware chunks in a durable worker, embed them with OpenAI, and atomically activate a searchable pgvector index.

**Architecture:** The client computes deterministic SHA-256 hashes, uploads gzip-compressed block batches, persists acknowledgements, and explicitly commits a version. FastAPI stores uploads and durable jobs in PostgreSQL. A separate Python worker claims jobs with `FOR UPDATE SKIP LOCKED`, chunks content, batches OpenAI embedding calls, and swaps the completed version into service transactionally.

**Tech Stack:** Expo FileSystem, Expo Crypto, `fflate`, FastAPI, Pydantic, SQLAlchemy, PostgreSQL, pgvector, OpenAI Embeddings API, `tiktoken`, pytest, Jest

**Prerequisite:** Complete `2026-06-11-rag-foundation-auth-database.md`.

---

## File Map

- Create `backend/app/indexing/models.py`: indexing SQLAlchemy models and enums.
- Create `backend/app/indexing/schemas.py`: upload/status/retry API contracts.
- Create `backend/app/indexing/repository.py`: ownership-scoped persistence operations.
- Create `backend/app/indexing/service.py`: upload lifecycle and atomic activation.
- Create `backend/app/indexing/chunker.py`: structure-aware chunk construction.
- Create `backend/app/indexing/embeddings.py`: embedding provider interface and OpenAI implementation.
- Create `backend/app/indexing/jobs.py`: lease-based job claiming and state transitions.
- Create `backend/app/indexing/dispatch.py`: provider-neutral dispatch interface and PostgreSQL default.
- Create `backend/app/indexing/sqs_dispatch.py`: optional LocalStack/SQS contract adapter.
- Create `backend/app/indexing/worker.py`: one-job indexing orchestration.
- Create `backend/app/worker_main.py`: worker process entry point.
- Create `backend/app/routers/indexing.py`: upload, commit, status, retry, and delete endpoints.
- Create `backend/alembic/versions/20260611_0002_indexing.py`: indexing tables, vector, GIN, and ownership indexes.
- Create `src/rag/types.ts`: client indexing state and API contracts.
- Create `src/rag/hashBook.ts`: canonical block and book hashes.
- Create `src/rag/buildBatches.ts`: 100-250 block batches and gzip body.
- Create `src/rag/indexApi.ts`: authenticated indexing endpoints.
- Create `src/rag/indexBook.ts`: resumable upload coordinator.
- Create `src/components/WholeBookAiSheet.tsx`: consent, progress, failure, and retry UI.
- Modify `App.tsx:196-209`: persisted `LibraryItem` indexing state and schema version.
- Modify `App.tsx:2437-2458`: cloud-first deletion for indexed books.
- Modify `App.tsx:2743-2859`: post-import whole-book AI consent entry point.
- Modify `package.json`: worker command and gzip dependency.

### Task 1: Add Indexing Tables and Migration

**Files:**
- Create: `backend/app/indexing/__init__.py`
- Create: `backend/app/indexing/models.py`
- Create: `backend/alembic/versions/20260611_0002_indexing.py`
- Create: `backend/tests/integration/test_indexing_models.py`

- [ ] **Step 1: Write the failing cascade and version-isolation test**

```python
def test_deleting_book_cascades_private_index_content(db_session, user):
    book = Book(user_id=user.id, client_book_id="local-1", title="Book", author="Author", source_type="epub")
    db_session.add(book)
    db_session.flush()
    version = IndexVersion(
        book_id=book.id,
        content_hash="a" * 64,
        embedding_model="text-embedding-3-small",
        embedding_dimensions=1536,
        chunking_version="v1",
        expected_block_count=1,
        status=IndexVersionStatus.UPLOADING,
    )
    db_session.add(version)
    db_session.commit()

    db_session.delete(book)
    db_session.commit()

    assert db_session.get(IndexVersion, version.id) is None
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/integration/test_indexing_models.py -v`

Expected: FAIL because indexing models do not exist.

- [ ] **Step 3: Define indexing models**

Use Python enums whose database values match the client states:

```python
class IndexVersionStatus(str, Enum):
    UPLOADING = "uploading"
    QUEUED = "queued"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"
    DELETING = "deleting"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    RETRY = "retry"
    COMPLETE = "complete"
    FAILED = "failed"
```

Define `Book`, `IndexVersion`, `BookBlock`, `UploadBatch`, `RagChunk`, and `IndexJob` with every field listed in the approved design. `Book.user_id` and all foreign keys use `ON DELETE CASCADE`. `RagChunk.embedding` is `Vector(1536)` and `search_vector` is a generated `TSVECTOR` from `embedding_input_text`.

- [ ] **Step 4: Add migration indexes and constraints**

The migration must include:

```python
op.create_index("ix_books_user_client", "books", ["user_id", "client_book_id"], unique=True)
op.create_index("ix_book_blocks_version_order", "book_blocks", ["index_version_id", "reading_order"], unique=True)
op.create_index("ix_upload_batches_version_sequence", "upload_batches", ["index_version_id", "sequence_number"], unique=True)
op.create_index("ix_rag_chunks_version_order", "rag_chunks", ["index_version_id", "chunk_order"], unique=True)
op.execute("CREATE INDEX ix_rag_chunks_embedding ON rag_chunks USING hnsw (embedding vector_cosine_ops)")
op.execute("CREATE INDEX ix_rag_chunks_search_vector ON rag_chunks USING gin (search_vector)")
op.create_index("ix_index_jobs_claim", "index_jobs", ["status", "next_attempt_at", "lease_expires_at"])
```

- [ ] **Step 5: Run migration and tests**

Run:

```bash
alembic -c backend/alembic.ini upgrade head
pytest -c backend/pytest.ini backend/tests/integration/test_indexing_models.py -v
```

Expected: migration succeeds and model tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/indexing backend/alembic backend/tests/integration/test_indexing_models.py
git commit -m "feat: add whole-book index schema"
```

### Task 2: Add Upload Contracts and Resumable Persistence

**Files:**
- Create: `backend/app/indexing/schemas.py`
- Create: `backend/app/indexing/repository.py`
- Create: `backend/app/indexing/service.py`
- Create: `backend/app/routers/indexing.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_index_upload_api.py`

- [ ] **Step 1: Write failing API tests for create, replay, conflict, and commit**

```python
def test_identical_batch_replay_is_idempotent(auth_client):
    created = auth_client.post("/library/books/index", json=book_index_request()).json()
    path = f"/library/books/{created['bookId']}/index/versions/{created['versionId']}/batches/0"
    headers = {"Idempotency-Key": "batch-0", "X-Payload-SHA256": "payload-hash"}

    first = auth_client.put(path, content=gzip_json(batch_request()), headers={**headers, "Content-Encoding": "gzip"})
    second = auth_client.put(path, content=gzip_json(batch_request()), headers={**headers, "Content-Encoding": "gzip"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["replayed"] is True


def test_conflicting_batch_replay_returns_409(auth_client):
    # Create upload, send sequence 0, then send different content with the same sequence.
    assert conflicting_replay_response(auth_client).status_code == 409


def test_completed_content_hash_is_reused_only_for_same_user(auth_client, other_auth_client):
    completed = create_completed_index(auth_client, content_hash="a" * 64)
    same_user = auth_client.post("/library/books/index", json=book_index_request(content_hash="a" * 64))
    other_user = other_auth_client.post("/library/books/index", json=book_index_request(content_hash="a" * 64))
    assert same_user.json()["reused"] is True
    assert same_user.json()["versionId"] == str(completed.version_id)
    assert other_user.json()["reused"] is False
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/test_index_upload_api.py -v`

Expected: FAIL with 404 for the new routes.

- [ ] **Step 3: Define strict Pydantic contracts**

```python
class IndexBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    paragraph_id: str = Field(alias="paragraphId", min_length=1, max_length=160)
    text: str = Field(min_length=1, max_length=5000)
    reading_order: int = Field(alias="readingOrder", ge=0)
    block_kind: str = Field(alias="blockKind", max_length=40)
    chapter_id: str | None = Field(default=None, alias="chapterId", max_length=160)
    chapter_title: str | None = Field(default=None, alias="chapterTitle", max_length=300)
    source_ref: dict[str, Any] = Field(alias="sourceRef")


class CreateIndexRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    client_book_id: str = Field(alias="clientBookId", min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(min_length=1, max_length=300)
    source_type: Literal["epub", "pdf", "scan"] = Field(alias="sourceType")
    file_name: str | None = Field(default=None, alias="fileName", max_length=500)
    content_hash: str = Field(alias="contentHash", pattern=r"^[a-f0-9]{64}$")
    block_count: int = Field(alias="blockCount", ge=1, le=100_000)
    parser_schema_version: int = Field(alias="parserSchemaVersion", ge=1)
```

- [ ] **Step 4: Implement ownership-scoped upload lifecycle**

`IndexingService` implements `create_or_resume`, `store_batch`, `commit`, `status`, `retry`, and `delete_book_index` with the request/response types defined in this task. Every query includes `Book.user_id == user_id`. `create_or_resume` reuses a completed matching `(user_id, content_hash, embedding_model, chunking_version)` only for the same logical client book; it never reuses content across users. Enforce 100,000 blocks, 20 million normalized characters per book, 4 MiB decompressed bytes per batch, 5,000 characters per block, and 8 KiB serialized `sourceRef` per block. Commit verifies contiguous sequences from zero, exact block count, and recomputed ordered content hash before inserting one queued `IndexJob`.

- [ ] **Step 5: Decode gzip explicitly in the batch route**

```python
raw = await request.body()
if request.headers.get("content-encoding") == "gzip":
    raw = gzip.decompress(raw)
batch = IndexBatchRequest.model_validate_json(raw)
```

Reject decompressed payloads over the configured byte limit before validation. Require `Idempotency-Key` and `X-Payload-SHA256` headers.

- [ ] **Step 6: Run API tests**

Run: `pytest -c backend/pytest.ini backend/tests/test_index_upload_api.py -v`

Expected: create/resume, replay, conflict, commit, ownership, and malformed gzip tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/indexing backend/app/routers/indexing.py backend/app/main.py backend/tests/test_index_upload_api.py
git commit -m "feat: add resumable index uploads"
```

### Task 3: Add Deterministic Client Hashing and Gzip Batches

**Files:**
- Modify: `package.json`
- Create: `src/rag/types.ts`
- Create: `src/rag/hashBook.ts`
- Create: `src/rag/hashBook.test.ts`
- Create: `src/rag/buildBatches.ts`
- Create: `src/rag/buildBatches.test.ts`

- [ ] **Step 1: Install gzip support and write failing hash tests**

Run: `npm install fflate`

```typescript
test('book hash is stable and changes with reading order', async () => {
  const first = await hashReaderBook(bookWithParagraphs(['one', 'two']));
  const repeat = await hashReaderBook(bookWithParagraphs(['one', 'two']));
  const reordered = await hashReaderBook(bookWithParagraphs(['two', 'one']));
  expect(first.contentHash).toBe(repeat.contentHash);
  expect(first.contentHash).not.toBe(reordered.contentHash);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/rag/hashBook.test.ts src/rag/buildBatches.test.ts`

Expected: FAIL because RAG client modules do not exist.

- [ ] **Step 3: Implement canonical hashing**

Use `Crypto.CryptoDigestAlgorithm.SHA256` and canonical key ordering:

```typescript
export type UploadBlock = {
  blockKind: ReaderBlockKind;
  chapterId?: string;
  chapterTitle?: string;
  paragraphId: string;
  readingOrder: number;
  sourceRef: DocumentSourceRef;
  text: string;
};

export async function hashUploadBlock(block: UploadBlock) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([
      block.paragraphId,
      block.readingOrder,
      block.blockKind,
      block.chapterId ?? null,
      block.chapterTitle ?? null,
      canonicalSourceRef(block.sourceRef),
      block.text.trim(),
    ]),
  );
}
```

Book hash input is `parserSchemaVersion`, source type, and the ordered block hashes joined with `\n`.

- [ ] **Step 4: Implement bounded batches and gzip**

`buildUploadBatches(blocks, targetSize = 150)` creates batches no smaller than 100 except the final batch and no larger than 250. `encodeBatch` returns a `Blob` containing `gzipSync(strToU8(JSON.stringify({ blocks })))`, the SHA-256 of the uncompressed canonical JSON, and block count.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- src/rag && npm run typecheck`

Expected: deterministic hash, source-ref sensitivity, batch boundaries, and gzip round-trip tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/rag
git commit -m "feat: prepare resumable book batches"
```

### Task 4: Add Client Index API and Resumable Coordinator

**Files:**
- Create: `src/rag/indexApi.ts`
- Create: `src/rag/indexBook.ts`
- Create: `src/rag/indexBook.test.ts`
- Modify: `App.tsx:196-209`
- Modify: `App.tsx:1390-1468`

- [ ] **Step 1: Write a failing resume test**

```typescript
test('resumes after the highest acknowledged batch', async () => {
  const api = fakeIndexApi({ highestAcknowledgedBatch: 1 });
  await indexBook({ api, book: testBook(450), localState: null, onProgress: jest.fn() });
  expect(api.uploadBatch.mock.calls.map(([request]) => request.sequence)).toEqual([2]);
  expect(api.commit).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/rag/indexBook.test.ts`

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement API methods**

Expose typed methods matching the approved endpoints:

```typescript
export type IndexApi = {
  createOrResume(request: CreateIndexRequest): Promise<CreateIndexResponse>;
  uploadBatch(request: UploadBatchRequest): Promise<UploadBatchResponse>;
  commit(bookId: string, versionId: string): Promise<IndexStatus>;
  getStatus(bookId: string): Promise<IndexStatus>;
  retry(bookId: string, versionId: string): Promise<IndexStatus>;
  deleteIndex(bookId: string): Promise<void>;
};
```

`uploadBatch` sends `Content-Encoding: gzip`, `Content-Type: application/json`, `Idempotency-Key`, and `X-Payload-SHA256` through the authenticated API client.

- [ ] **Step 4: Implement coordinator and persisted state**

```typescript
export type WholeBookAiState = {
  acknowledgedBatch: number;
  cloudBookId?: string;
  contentHash?: string;
  error?: string;
  progress: number;
  status: 'not_enabled' | 'uploading' | 'queued' | 'indexing' | 'ready' | 'failed' | 'deleting';
  versionId?: string;
};
```

Add `wholeBookAi: WholeBookAiState` to `LibraryItem`, increment persisted schema to 4, and hydrate older items to `{ acknowledgedBatch: -1, progress: 0, status: 'not_enabled' }`.

- [ ] **Step 5: Run resume and persistence tests**

Run: `npm test -- src/rag/indexBook.test.ts && npm run typecheck`

Expected: resume, retry-safe replay, commit, and schema migration tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/rag App.tsx
git commit -m "feat: coordinate resumable indexing"
```

### Task 5: Build the Structure-Aware Chunker

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/app/indexing/chunker.py`
- Create: `backend/tests/test_chunker.py`

- [ ] **Step 1: Add tokenizer dependency and failing chunk tests**

Add `tiktoken>=0.9.0` to `backend/requirements.txt`.

```python
def test_chunker_keeps_heading_with_body_and_stops_at_chapter():
    chunks = StructureAwareChunker(target_tokens=600, min_tokens=500, max_tokens=800).chunk(blocks_fixture())
    assert chunks[0].embedding_input_text.startswith("Chapter 1\n")
    assert chunks[0].chapter_id == "chapter-1"
    assert all(chunk.token_count <= 800 for chunk in chunks)
    assert not any(chunk.chapter_id == "chapter-1" and "Chapter 2" in chunk.raw_text for chunk in chunks)


def test_chunker_overlap_is_capped_at_one_hundred_tokens():
    chunks = StructureAwareChunker(target_tokens=600, min_tokens=500, max_tokens=800).chunk(
        long_blocks_fixture()
    )
    assert chunks[1].overlap_token_count <= 100
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/test_chunker.py -v`

Expected: FAIL because `StructureAwareChunker` does not exist.

- [ ] **Step 3: Implement chunk construction**

Create immutable `ChunkDraft` with raw text, embedding text, token count, reading-order range, paragraph IDs, page range, chapter metadata, and source refs. Use `tiktoken.get_encoding("cl100k_base")`. Flush before a chapter change or before adding a block would exceed 800 tokens. Keep pending heading blocks with the next body block. Add only the previous body block as overlap and truncate overlap to the final 100 tokens.

- [ ] **Step 4: Run chunk tests**

Run: `pytest -c backend/pytest.ini backend/tests/test_chunker.py -v`

Expected: heading, chapter boundary, PDF page span, overlap, and token-cap tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/indexing/chunker.py backend/tests/test_chunker.py
git commit -m "feat: chunk book structure for retrieval"
```

### Task 6: Add the OpenAI Embedding Provider

**Files:**
- Modify: `backend/app/config.py`
- Create: `backend/app/indexing/embeddings.py`
- Create: `backend/tests/test_embeddings.py`
- Modify: `backend/.env.example`

- [ ] **Step 1: Write failing provider tests with a fake OpenAI client**

```python
def test_embed_documents_preserves_input_order(fake_openai):
    provider = OpenAIEmbeddingProvider(fake_openai, model="text-embedding-3-small", dimensions=1536)
    result = provider.embed_documents(["first", "second"])
    assert result == [[1.0, 0.0], [0.0, 1.0]]
    fake_openai.embeddings.create.assert_called_once_with(
        model="text-embedding-3-small",
        dimensions=1536,
        encoding_format="float",
        input=["first", "second"],
    )
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/test_embeddings.py -v`

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Add settings and provider interface**

Add `OPENAI_EMBEDDING_MODEL=text-embedding-3-small` and `OPENAI_EMBEDDING_DIMENSIONS=1536` settings. Define:

```python
class EmbeddingProvider(Protocol):
    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        pass

    def embed_query(self, text: str) -> list[float]:
        pass
```

`OpenAIEmbeddingProvider` calls `client.embeddings.create(model=model, dimensions=dimensions, encoding_format="float", input=batch)`, rejects empty inputs, batches at 64, verifies returned count and dimensions, and retries only rate-limit, timeout, and 5xx errors with bounded exponential backoff and jitter.

- [ ] **Step 4: Run provider tests**

Run: `pytest -c backend/pytest.ini backend/tests/test_embeddings.py -v`

Expected: order, dimensions, batching, transient retry, and permanent-failure tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/app/indexing/embeddings.py backend/tests/test_embeddings.py backend/.env.example
git commit -m "feat: add openai embedding provider"
```

### Task 7: Add Durable Job Claims and the Local Worker

**Files:**
- Create: `backend/app/indexing/jobs.py`
- Create: `backend/app/indexing/dispatch.py`
- Create: `backend/app/indexing/worker.py`
- Create: `backend/app/worker_main.py`
- Create: `backend/tests/integration/test_jobs.py`
- Create: `backend/tests/test_worker.py`
- Modify: `package.json`

- [ ] **Step 1: Write failing lease and atomic activation tests**

```python
def test_only_one_worker_claims_a_job(session_factory, queued_job):
    first = JobRepository(session_factory).claim("worker-a")
    second = JobRepository(session_factory).claim("worker-b")
    assert first.id == queued_job.id
    assert second is None


def test_failed_rebuild_keeps_previous_active_version(worker_fixture):
    result = worker_fixture.run_with_embedding_failure()
    assert result.book.active_index_version_id == result.previous_version.id
    assert result.pending_version.status == IndexVersionStatus.FAILED
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/integration/test_jobs.py backend/tests/test_worker.py -v`

Expected: FAIL because job and worker modules do not exist.

- [ ] **Step 3: Implement job leasing**

Claim using one transaction and PostgreSQL row locking:

```python
job = session.scalar(
    select(IndexJob)
    .where(
        IndexJob.status.in_([JobStatus.QUEUED, JobStatus.RETRY]),
        IndexJob.next_attempt_at <= func.now(),
        or_(IndexJob.lease_expires_at.is_(None), IndexJob.lease_expires_at < func.now()),
    )
    .order_by(IndexJob.created_at)
    .with_for_update(skip_locked=True)
    .limit(1)
)
```

Set a 60-second lease, heartbeat every 20 seconds, and increment attempts on claim. A retryable failure schedules `next_attempt_at` with capped backoff; attempt 5 becomes terminal `failed`.

- [ ] **Step 4: Implement one-job indexing orchestration**

`IndexWorker.process(job)` loads ordered blocks, builds chunks, hashes each chunk, embeds missing chunk hashes in batches of 64, upserts rows, verifies every chunk has an embedding, then in one transaction marks the version ready and updates `Book.active_index_version_id`. Heartbeat between chunking and every embedding batch.

After activation, enqueue a bounded cleanup job that deletes superseded private versions in batches of 1,000 rows. Cleanup never removes the active version and retries independently from indexing.

- [ ] **Step 5: Add worker process command**

```python
# backend/app/worker_main.py
def main() -> None:
    worker = build_worker(get_settings())
    worker.run_forever(poll_seconds=2.0)


if __name__ == "__main__":
    main()
```

Add to `package.json`:

```json
"worker": "python3 -m backend.app.worker_main"
```

- [ ] **Step 6: Run worker tests**

Run: `pytest -c backend/pytest.ini backend/tests/integration/test_jobs.py backend/tests/test_worker.py -v`

Expected: exclusive claim, expired lease recovery, heartbeat, idempotent restart, failed rebuild preservation, and atomic activation tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/indexing backend/app/worker_main.py backend/tests package.json
git commit -m "feat: process durable indexing jobs"
```

### Task 8: Add the Optional LocalStack Queue Contract Profile

**Files:**
- Modify: `compose.yaml`
- Modify: `backend/requirements.txt`
- Create: `backend/app/indexing/sqs_dispatch.py`
- Create: `backend/tests/integration/test_sqs_dispatch.py`

- [ ] **Step 1: Write a failing at-least-once dispatch test**

```python
def test_duplicate_sqs_delivery_claims_the_database_job_once(localstack_sqs, queued_job, worker):
    dispatcher = SqsJobDispatcher(localstack_sqs.queue_url, localstack_sqs.client)
    dispatcher.enqueue(queued_job.id)
    dispatcher.enqueue(queued_job.id)

    worker.consume_once(dispatcher)
    worker.consume_once(dispatcher)

    assert worker.processed_job_ids == [queued_job.id]
```

- [ ] **Step 2: Run the test and verify it is skipped without the profile**

Run: `pytest -c backend/pytest.ini backend/tests/integration/test_sqs_dispatch.py -v`

Expected: SKIPPED with `LOCALSTACK_ENDPOINT is not configured`.

- [ ] **Step 3: Add the optional LocalStack services**

Add a `queue` profile containing LocalStack, a one-shot queue initializer, `reader-index-jobs`, and `reader-index-jobs-dlq`. Do not add this profile to default `docker compose up`.

```yaml
  localstack:
    image: localstack/localstack:4
    profiles: ["queue"]
    environment:
      SERVICES: sqs
    ports:
      - "4566:4566"
```

- [ ] **Step 4: Implement the optional SQS adapter**

Add `boto3>=1.38.0`. `SqsJobDispatcher.enqueue(job_id)` sends only the durable PostgreSQL job UUID. The consumer receives one message, asks `JobRepository.claim_by_id(job_id, worker_id)` to acquire the database lease, processes only when the claim succeeds, deletes the message after completion, and leaves retryable failures for visibility timeout redelivery. Database state remains authoritative.

- [ ] **Step 5: Run the queue contract test**

Run:

```bash
docker compose --profile queue up -d localstack
LOCALSTACK_ENDPOINT=http://localhost:4566 pytest -c backend/pytest.ini backend/tests/integration/test_sqs_dispatch.py -v
```

Expected: duplicate delivery, visibility redelivery, and DLQ redrive tests pass.

- [ ] **Step 6: Commit**

```bash
git add compose.yaml backend/requirements.txt backend/app/indexing/sqs_dispatch.py backend/tests/integration/test_sqs_dispatch.py
git commit -m "test: add optional queue contract profile"
```

### Task 9: Add Consent, Progress, Retry, and Cloud-First Deletion UI

**Files:**
- Create: `src/components/WholeBookAiSheet.tsx`
- Create: `src/components/WholeBookAiSheet.test.tsx`
- Modify: `App.tsx:2305-3235`
- Modify: `App.tsx:3238-3380`

- [ ] **Step 1: Write failing consent and retry UI tests**

```typescript
test('discloses normalized text upload before enabling', () => {
  const screen = render(<WholeBookAiSheet state={notEnabledState} onEnable={jest.fn()} onRetry={jest.fn()} onClose={jest.fn()} />);
  expect(screen.getByText(/normalized book text will be uploaded/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Enable whole-book AI' })).toBeTruthy();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/components/WholeBookAiSheet.test.tsx`

Expected: FAIL because the sheet does not exist.

- [ ] **Step 3: Implement the lifecycle UI**

The sheet renders `not_enabled`, `uploading`, `queued`, `indexing`, `ready`, and `failed` states. Upload/index progress uses a fixed-height progress track. Failed state shows sanitized error text and a Retry command. Ready state confirms that Book scope is available. While `deleting`, all AI actions for that book are disabled and the library item shows deletion progress.

- [ ] **Step 4: Wire enable, polling, resume, and retry**

After import, expose `Enable whole-book AI` in the library item and reader actions. Enabling calls `indexBook`. While `queued` or `indexing`, poll status at 2 seconds, then 5 seconds after five unchanged responses. App startup resumes `uploading` items and polling items automatically after auth restoration.

- [ ] **Step 5: Make indexed deletion cloud-first**

Change `deleteLibraryItem` to async. If `cloudBookId` exists, set `deleting`, call `DELETE /library/books/{id}/index`, and only remove the local item after success. On offline/failure, keep the item and set a retryable error. Local `sample` and `not_enabled` books retain immediate deletion behavior.

- [ ] **Step 6: Run frontend and backend acceptance tests**

Run:

```bash
npm test
npm run typecheck
pytest -c backend/pytest.ini backend/tests -v
```

Expected: all tests pass.

- [ ] **Step 7: Perform local worker recovery smoke test**

Run API and worker in separate terminals, enable indexing for a fixture book, stop the worker during embeddings, wait beyond lease expiry, restart the worker, and confirm status reaches `ready` without duplicate chunks.

- [ ] **Step 8: Commit**

```bash
git add App.tsx src/components
git commit -m "feat: expose whole-book indexing lifecycle"
```

## Phase Acceptance

- Upload interruption resumes from the first missing batch.
- Identical batch replay succeeds; conflicting replay returns 409.
- Worker death recovers after lease expiry without duplicate chunks.
- No pending index is searchable until every chunk has an embedding.
- Failed rebuilds leave the previous active index available.
- Deleting an indexed book removes server content before local removal.
- Original EPUB, PDF, and image files never leave the device.
