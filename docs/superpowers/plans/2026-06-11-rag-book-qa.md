# Hybrid Book Q&A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer Book-scope questions with hybrid pgvector/full-text retrieval, spoiler-aware filtering, grounded structured responses, and tappable citations in the existing reader UI.

**Architecture:** FastAPI embeds the question, runs vector and PostgreSQL full-text searches against the authenticated user's active index, fuses ranks with RRF, expands safe neighbors, and sends only retrieved evidence to the Responses API. The client adds `Book` to the existing Ask selector, defaults to `Book so far`, renders citations inline, and jumps to the supporting paragraph/source reference.

**Tech Stack:** PostgreSQL pgvector and FTS, SQLAlchemy, OpenAI Embeddings API, OpenAI Responses API Structured Outputs, FastAPI, Expo React Native, Jest, pytest

**Prerequisite:** Complete `2026-06-11-rag-indexing-pipeline.md`.

**OpenAI references:** [Vector embeddings](https://developers.openai.com/api/docs/guides/embeddings) and [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

---

## File Map

- Create `backend/app/retrieval/models.py`: retrieval candidates, fused evidence, and answer result types.
- Create `backend/app/retrieval/rrf.py`: Reciprocal Rank Fusion.
- Create `backend/app/retrieval/repository.py`: vector, FTS, and neighbor SQL.
- Create `backend/app/retrieval/service.py`: spoiler filtering, fusion, evidence cap, and weak-evidence decision.
- Create `backend/app/retrieval/prompts.py`: grounded Book Answer instructions and evidence formatting.
- Create `backend/app/retrieval/answerer.py`: Responses API structured-answer provider.
- Create `backend/app/retrieval/schemas.py`: Book Ask request/response contracts.
- Create `backend/app/routers/book_ask.py`: authenticated `/library/books/{book_id}/ask` endpoint.
- Create `src/rag/bookAskApi.ts`: authenticated client contract.
- Create `src/rag/bookAskTypes.ts`: answer/citation types.
- Create `src/components/BookSources.tsx`: one-to-three citation links.
- Modify `App.tsx:55-60`: add Book scope and Book Ask request state.
- Modify `App.tsx:150-153`: extend insights with support and citations.
- Modify `App.tsx:3060-3082`: route Book questions to the RAG endpoint.
- Modify `App.tsx:4263-4276`: label and map Book scope.
- Modify `App.tsx:4449-4515`: render citations in the existing insight card.
- Modify `App.tsx:4518-4599`: Book scope state, readiness, and whole-book toggle.
- Create `docs/production-deployment-checklist.md`: mandatory durable queue release gate.

### Task 1: Implement Reciprocal Rank Fusion and Evidence Types

**Files:**
- Create: `backend/app/retrieval/__init__.py`
- Create: `backend/app/retrieval/models.py`
- Create: `backend/app/retrieval/rrf.py`
- Create: `backend/tests/test_rrf.py`

- [ ] **Step 1: Write failing RRF tests**

```python
def test_rrf_rewards_candidates_present_in_both_rankings():
    vector = [candidate("a"), candidate("b"), candidate("c")]
    keyword = [candidate("c"), candidate("a"), candidate("d")]
    fused = reciprocal_rank_fusion(vector, keyword, k=60)
    assert [item.chunk_id for item in fused[:2]] == ["a", "c"]


def test_rrf_deduplicates_same_chunk():
    fused = reciprocal_rank_fusion([candidate("a")], [candidate("a")], k=60)
    assert len(fused) == 1
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/test_rrf.py -v`

Expected: FAIL because retrieval modules do not exist.

- [ ] **Step 3: Define immutable retrieval types and RRF**

```python
@dataclass(frozen=True)
class RetrievalCandidate:
    chunk_id: UUID
    chunk_order: int
    raw_text: str
    start_reading_order: int
    end_reading_order: int
    chapter_id: str | None
    chapter_title: str | None
    page_start: int | None
    page_end: int | None
    paragraph_ids: list[str]
    source_refs: list[dict[str, Any]]
    vector_similarity: float | None = None
    keyword_rank: float | None = None


def reciprocal_rank_fusion(*rankings: Sequence[RetrievalCandidate], k: int = 60) -> list[FusedCandidate]:
    scores: dict[UUID, float] = defaultdict(float)
    candidates: dict[UUID, RetrievalCandidate] = {}
    for ranking in rankings:
        for rank, candidate in enumerate(ranking, start=1):
            scores[candidate.chunk_id] += 1.0 / (k + rank)
            candidates[candidate.chunk_id] = candidate
    return sorted(
        (FusedCandidate(candidate=candidates[chunk_id], score=score) for chunk_id, score in scores.items()),
        key=lambda item: (-item.score, item.candidate.chunk_order),
    )
```

- [ ] **Step 4: Run RRF tests**

Run: `pytest -c backend/pytest.ini backend/tests/test_rrf.py -v`

Expected: all fusion tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval backend/tests/test_rrf.py
git commit -m "feat: fuse hybrid retrieval rankings"
```

### Task 2: Add Ownership-Scoped Vector and Full-Text Retrieval

**Files:**
- Create: `backend/app/retrieval/repository.py`
- Create: `backend/tests/integration/test_retrieval_repository.py`

- [ ] **Step 1: Write failing hybrid retrieval tests**

```python
def test_vector_and_keyword_search_are_scoped_to_active_user_version(retrieval_fixture):
    results = retrieval_fixture.repository.search(
        user_id=retrieval_fixture.user.id,
        book_id=retrieval_fixture.book.id,
        query="monetary policy",
        query_embedding=retrieval_fixture.query_embedding,
        max_reading_order=120,
    )
    assert all(result.start_reading_order <= 120 for result in results.vector)
    assert all(result.chunk_id not in retrieval_fixture.other_user_chunk_ids for result in results.vector)
    assert all(result.chunk_id not in retrieval_fixture.other_user_chunk_ids for result in results.keyword)
```

- [ ] **Step 2: Run test and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/integration/test_retrieval_repository.py -v`

Expected: FAIL because repository search does not exist.

- [ ] **Step 3: Implement vector query**

Use `Book.user_id`, `Book.active_index_version_id`, and reading-order filters in the SQL itself. Order by cosine distance and return similarity as `1 - distance`:

```sql
SELECT rc.*, 1 - (rc.embedding <=> CAST(:query_embedding AS vector)) AS vector_similarity
FROM rag_chunks rc
JOIN index_versions iv ON iv.id = rc.index_version_id
JOIN books b ON b.active_index_version_id = iv.id
WHERE b.id = :book_id
  AND b.user_id = :user_id
  AND (:max_reading_order IS NULL OR rc.start_reading_order <= :max_reading_order)
  AND (:max_reading_order IS NULL OR rc.end_reading_order <= :max_reading_order)
ORDER BY rc.embedding <=> CAST(:query_embedding AS vector)
LIMIT 30
```

- [ ] **Step 4: Implement full-text and neighbor queries**

Use `websearch_to_tsquery('english', :query)` and `ts_rank_cd`. The neighbor method accepts fused chunk orders, loads at most `order - 1` and `order + 1`, requires the same chapter, and reapplies the maximum reading order.

- [ ] **Step 5: Run integration tests**

Run: `pytest -c backend/pytest.ini backend/tests/integration/test_retrieval_repository.py -v`

Expected: vector, keyword, active-version, ownership, spoiler, and neighbor tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/retrieval/repository.py backend/tests/integration/test_retrieval_repository.py
git commit -m "feat: retrieve hybrid book evidence"
```

### Task 3: Build Retrieval Orchestration and Weak-Evidence Abstention

**Files:**
- Create: `backend/app/retrieval/service.py`
- Create: `backend/tests/test_retrieval_service.py`
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example`

- [ ] **Step 1: Write failing spoiler and weak-evidence tests**

```python
def test_book_so_far_excludes_chunks_after_current_position(service_fixture):
    evidence = service_fixture.retrieve(include_whole_book=False, current_reading_order=50)
    assert all(item.end_reading_order <= 50 for item in evidence.items)


def test_weak_evidence_abstains(service_fixture):
    service_fixture.vector_similarity = 0.12
    service_fixture.keyword_results = []
    evidence = service_fixture.retrieve()
    assert evidence.supported is False
    assert evidence.reason == "weak_retrieval"
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/test_retrieval_service.py -v`

Expected: FAIL because retrieval orchestration does not exist.

- [ ] **Step 3: Implement configured retrieval pipeline**

Add settings:

```env
RAG_VECTOR_CANDIDATES=30
RAG_KEYWORD_CANDIDATES=30
RAG_FUSED_CANDIDATES=8
RAG_RRF_K=60
RAG_MIN_VECTOR_SIMILARITY=0.35
RAG_CONTEXT_MAX_CHARS=18000
```

`RetrievalService.retrieve` embeds the query, executes both searches, fuses them, keeps eight, expands one safe neighbor per side, removes duplicate paragraph spans, and caps context at 18,000 characters without splitting a source excerpt. Weak evidence is true only when there is no meaningful FTS result and best vector similarity is below the configured threshold.

- [ ] **Step 4: Run service tests**

Run: `pytest -c backend/pytest.ini backend/tests/test_retrieval_service.py -v`

Expected: spoiler, whole-book override, deduplication, neighbor, context cap, and weak-evidence tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/service.py backend/app/config.py backend/.env.example backend/tests/test_retrieval_service.py
git commit -m "feat: orchestrate spoiler-aware retrieval"
```

### Task 4: Generate Grounded Structured Answers

**Files:**
- Create: `backend/app/retrieval/schemas.py`
- Create: `backend/app/retrieval/prompts.py`
- Create: `backend/app/retrieval/answerer.py`
- Create: `backend/tests/test_book_answerer.py`

- [ ] **Step 1: Write failing citation validation tests**

```python
def test_answerer_removes_citations_not_in_retrieved_sources(fake_responses_client):
    fake_responses_client.output_parsed = ModelBookAnswer(
        supported=True,
        eyebrow="Book answer",
        body="The policy changes borrowing costs.",
        citation_ids=["source-1", "invented-source"],
    )
    result = answerer(fake_responses_client).answer(question="Why?", evidence=evidence(["source-1"]))
    assert [source.id for source in result.sources] == ["source-1"]


def test_no_valid_citation_becomes_insufficient_evidence(fake_responses_client):
    fake_responses_client.output_parsed.citation_ids = ["invented-source"]
    result = answerer(fake_responses_client).answer(
        question="Why?",
        evidence=evidence(["source-1"]),
    )
    assert result.supported is False
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/test_book_answerer.py -v`

Expected: FAIL because answerer modules do not exist.

- [ ] **Step 3: Define structured model output**

```python
class ModelBookAnswer(BaseModel):
    supported: bool
    eyebrow: str = Field(max_length=40)
    body: str = Field(max_length=1200)
    citation_ids: list[str] = Field(max_length=3)
```

The prompt assigns each evidence block a stable source ID and says: use only supplied evidence, do not use general knowledge, return `supported=false` when evidence is insufficient, and cite only listed IDs.

- [ ] **Step 4: Implement Responses API parsing**

```python
response = self._client.responses.parse(
    model=self._model,
    instructions=BOOK_ANSWER_SYSTEM_PROMPT,
    input=build_book_answer_prompt(question, evidence),
    max_output_tokens=500,
    text_format=ModelBookAnswer,
)
```

Preserve the configured reasoning effort. Validate returned citation IDs against evidence, keep one to three distinct citations in first-use order, and convert unsupported or citation-less output to the fixed insufficient-evidence answer.

- [ ] **Step 5: Run answerer tests**

Run: `pytest -c backend/pytest.ini backend/tests/test_book_answerer.py -v`

Expected: structured parse, refusal, invalid citation, duplicate citation, and abstention tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/retrieval backend/tests/test_book_answerer.py
git commit -m "feat: generate grounded book answers"
```

### Task 5: Add the Authenticated Book Ask Endpoint and Diagnostics

**Files:**
- Create: `backend/app/routers/book_ask.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_book_ask_api.py`

- [ ] **Step 1: Write failing endpoint tests**

```python
def test_book_ask_returns_sources(auth_client, ready_book):
    response = auth_client.post(
        f"/library/books/{ready_book.id}/ask",
        json={
            "question": "What changes borrowing costs?",
            "currentParagraphId": "p-40",
            "currentReadingOrder": 40,
            "currentChapterId": "chapter-2",
            "includeWholeBook": False,
        },
    )
    assert response.status_code == 200
    assert 1 <= len(response.json()["sources"]) <= 3


def test_book_ask_rejects_non_ready_index(auth_client, uploading_book):
    response = auth_client.post(f"/library/books/{uploading_book.id}/ask", json=ask_request())
    assert response.status_code == 409
    assert response.json()["detail"]["status"] == "uploading"
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest -c backend/pytest.ini backend/tests/test_book_ask_api.py -v`

Expected: FAIL with 404.

- [ ] **Step 3: Implement request and response contracts**

```python
class BookAskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    question: str = Field(min_length=1, max_length=1000)
    current_paragraph_id: str = Field(alias="currentParagraphId", min_length=1, max_length=160)
    current_reading_order: int = Field(alias="currentReadingOrder", ge=0)
    current_chapter_id: str | None = Field(default=None, alias="currentChapterId", max_length=160)
    include_whole_book: bool = Field(default=False, alias="includeWholeBook")


class BookAskResponse(BaseModel):
    request_id: str = Field(alias="requestId")
    eyebrow: str
    body: str
    supported: bool
    sources: list[BookSourceResponse] = Field(max_length=3)
```

- [ ] **Step 4: Implement endpoint and structured diagnostics**

Create a UUID request ID per request. Log user ID hash, book/version IDs, retrieval ranks/scores/chunk IDs, timings for query embedding/vector/FTS/fusion/generation/total, model versions, citation IDs, and abstention reason. Do not log raw question or book text.

- [ ] **Step 5: Run API and ownership tests**

Run: `pytest -c backend/pytest.ini backend/tests/test_book_ask_api.py -v`

Expected: ready, non-ready, auth, cross-user, spoiler, whole-book override, and response-shape tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/book_ask.py backend/app/main.py backend/tests/test_book_ask_api.py
git commit -m "feat: expose grounded book questions"
```

### Task 6: Add Book Scope to the Reader Ask Flow

**Files:**
- Create: `src/rag/bookAskTypes.ts`
- Create: `src/rag/bookAskApi.ts`
- Create: `src/rag/bookAskApi.test.ts`
- Modify: `App.tsx:55-60`
- Modify: `App.tsx:150-153`
- Modify: `App.tsx:3060-3082`
- Modify: `App.tsx:4263-4276`
- Modify: `App.tsx:4518-4599`

- [ ] **Step 1: Write a failing Book Ask API test**

```typescript
test('sends book-so-far by default', async () => {
  const api = createBookAskApi(fakeAuthenticatedClient());
  await api.ask('book-1', {
    currentChapterId: 'chapter-2',
    currentParagraphId: 'p40',
    currentReadingOrder: 40,
    includeWholeBook: false,
    question: 'What causes inflation here?',
  });
  expect(lastRequestBody()).toEqual(expect.objectContaining({ includeWholeBook: false }));
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/rag/bookAskApi.test.ts`

Expected: FAIL because the Book Ask client does not exist.

- [ ] **Step 3: Add client contracts**

```typescript
export type BookSource = {
  chapterTitle?: string;
  excerpt: string;
  pageIndex?: number;
  pageLabel?: string;
  paragraphId: string;
  sourceRef: DocumentSourceRef;
};

export type BookAskResponse = Insight & {
  requestId: string;
  sources: BookSource[];
  supported: boolean;
};
```

- [ ] **Step 4: Extend Ask scope and submission routing**

Change `AskContextScope` to `'selection' | 'visiblePage' | 'chapter' | 'book'`. Add Book to the segmented control. When Book is selected, the sheet remains available even without manual selection, uses current reading location as the anchor, shows status when the index is not ready, and routes submission to `bookAskApi.ask` instead of `/ai/assist`.

- [ ] **Step 5: Add `Include whole book` switch**

Show the switch only in Book scope. Default it to false each time the Ask sheet opens or active book changes. Label the default state `Book so far`; enabling it shows concise spoiler text and sends `includeWholeBook: true`.

- [ ] **Step 6: Preserve selection/page/chapter behavior**

`getAssistScopeForAsk` remains valid only for non-Book scopes. Add an exhaustive branch in `submitQuestion`: Book uses the RAG endpoint; other scopes continue through `runAssist`/`runContextAssist` unchanged.

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test -- src/rag/bookAskApi.test.ts && npm run typecheck`

Expected: request contract and TypeScript checks pass.

- [ ] **Step 8: Commit**

```bash
git add src/rag App.tsx
git commit -m "feat: add Book ask scope"
```

### Task 7: Render and Navigate Tappable Sources

**Files:**
- Create: `src/components/BookSources.tsx`
- Create: `src/components/BookSources.test.tsx`
- Modify: `App.tsx:4449-4515`
- Modify: `App.tsx:2460-2590`

- [ ] **Step 1: Write failing citation UI test**

```typescript
test('opens the cited paragraph', () => {
  const onOpen = jest.fn();
  const screen = render(<BookSources sources={[sourceFixture({ paragraphId: 'p42' })]} onOpen={onOpen} />);
  fireEvent.press(screen.getByRole('button', { name: /chapter 3.*page 42/i }));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ paragraphId: 'p42' }));
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/components/BookSources.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement source links**

Render one to three unframed rows under the answer body. Each row uses a `BookOpen` icon, chapter/page label, and a two-line excerpt. The accessibility label includes chapter and page context. Do not nest a card inside `InsightCard`.

- [ ] **Step 4: Wire source navigation**

On press, close Ask/insight overlays, call existing paragraph validation and `setScrollTarget`, update reading location, and preserve the returned `sourceRef` for future PDF/scan image navigation. If the paragraph ID is absent locally, show `This source is not available in the local copy.` rather than jumping incorrectly.

- [ ] **Step 5: Preserve saved insight compatibility**

When saving a Book answer, use the first cited paragraph/source ref as the note anchor. Store the full answer body but not all retrieved evidence. Existing note search/export remains unchanged.

- [ ] **Step 6: Run UI tests and web export**

Run: `npm test -- src/components/BookSources.test.tsx && npm run typecheck && npx expo export --platform web`

Expected: tests, typecheck, and export pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/BookSources.tsx src/components/BookSources.test.tsx App.tsx
git commit -m "feat: link book answers to sources"
```

### Task 8: Add End-to-End Acceptance and Production Deployment Gate

**Files:**
- Create: `backend/tests/e2e/test_book_rag_flow.py`
- Create: `docs/production-deployment-checklist.md`
- Modify: `README.md`

- [ ] **Step 1: Add an end-to-end test with fake OpenAI providers**

```python
def test_index_then_ask_then_delete(auth_client, worker, fake_embeddings, fake_answerer):
    created = upload_and_commit_fixture_book(auth_client)
    worker.run_once()
    status = auth_client.get(f"/library/books/{created.book_id}/index-status")
    assert status.json()["status"] == "ready"

    answer = auth_client.post(f"/library/books/{created.book_id}/ask", json=ask_request())
    assert answer.status_code == 200
    assert answer.json()["supported"] is True
    assert answer.json()["sources"][0]["paragraphId"] == "p-12"

    assert auth_client.delete(f"/library/books/{created.book_id}/index").status_code == 204
    assert count_private_index_rows(created.book_id) == 0
```

- [ ] **Step 2: Run the full backend suite**

Run: `pytest -c backend/pytest.ini backend/tests -v`

Expected: all unit, integration, API, worker, and end-to-end tests pass without real OpenAI calls.

- [ ] **Step 3: Add the mandatory production queue checklist**

`docs/production-deployment-checklist.md` must block public deployment until all items are checked:

```markdown
- [ ] Replace PostgreSQL polling dispatch with a provider-selected durable queue.
- [ ] Publish through a transactional outbox or run reconciliation for unpublished jobs.
- [ ] Run indexing workers as a separately scalable service.
- [ ] Configure at-least-once delivery, visibility renewal, bounded retries, and a dead-letter queue.
- [ ] Autoscale workers from queue depth and verify graceful shutdown.
- [ ] Load-test upload, Ask, deletion, and worker recovery with multiple API instances.
- [ ] Confirm production logs exclude raw book text and full user questions.
- [ ] Configure per-user indexing and Book Ask rate limits.
```

State explicitly that SQS/ECS Fargate is one valid mapping, but the selected provider may be replaced by a lower-cost equivalent satisfying the same contract.

- [ ] **Step 4: Document deferred evaluation without weakening V1 logging**

README must state that formal context precision, recall, faithfulness, and human-review evaluation are outside V1. Retrieval IDs, ranks, scores, citations, model/config versions, latency, and abstention reasons are retained so a curated offline evaluation set can be replayed when evaluation work begins.

- [ ] **Step 5: Run complete project verification**

Run:

```bash
pytest -c backend/pytest.ini backend/tests -v
npm test
npm run typecheck
npx expo export --platform web
curl http://localhost:8000/health
```

Expected: all checks pass.

- [ ] **Step 6: Perform physical-iPhone smoke test on port 8081**

Run `npm start -- --port 8081`, connect the iPhone on the same Wi-Fi network, then verify sign-in, import, enable, interrupted upload resume, ready status, Book-so-far answer, whole-book answer, citation jump, unsupported-question abstention, and cloud-first deletion.

- [ ] **Step 7: Commit**

```bash
git add backend/tests/e2e docs/production-deployment-checklist.md README.md
git commit -m "test: cover whole-book rag workflow"
```

## Phase Acceptance

- Book scope is unavailable until indexing is ready.
- Book questions default to content at or before the current reading position.
- Later content appears only after explicit whole-book opt-in.
- Answers use only retrieved evidence and abstain when support is weak.
- Every displayed citation maps to a retrieved source and opens the correct local paragraph.
- Cross-user retrieval and deletion are impossible through API queries.
- Production deployment remains blocked until a durable external queue and separate workers are configured.
