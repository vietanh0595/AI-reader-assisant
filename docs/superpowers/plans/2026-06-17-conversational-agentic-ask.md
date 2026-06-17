# Conversational, Agentic Whole-Book Ask — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the whole-book Ask into a multi-turn assistant that selects its own context scope via tool calls, with on-device per-book conversation memory.

**Architecture:** A bounded tool-calling loop (`BookAgent`) on the OpenAI Responses API with two tools — `search_book` (existing RRF retrieval) and `read_current_context` (paragraphs at the reading position). The backend stays stateless; conversation history is sent from the device each turn. No LangChain/LangGraph.

**Tech Stack:** FastAPI, SQLAlchemy, pgvector, OpenAI Responses API (`responses.parse` with `tools` + `text_format`), Expo React Native, Jest.

**Spec:** `docs/superpowers/specs/2026-06-17-conversational-agentic-ask-design.md`
**Mockup:** `docs/mockups/conversational-ask.html`

---

## Phase 1 — Backend (agentic `/ask`)

Phase 1 produces a working, fully tested agentic endpoint. Run all backend commands with the repo venv: `.venv/bin/python -m pytest …`.

### Task 1: Extend the ask request schema

**Files:**
- Modify: `backend/app/retrieval/schemas.py`
- Test: `backend/tests/test_book_ask_api.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_book_ask_api.py`:

```python
from backend.app.retrieval.schemas import BookAskRequest


def test_book_ask_request_accepts_history_and_selected_text():
    req = BookAskRequest.model_validate({
        "question": "what is the best strategy?",
        "currentParagraphId": "p-1",
        "currentReadingOrder": 53,
        "includeWholeBook": True,
        "history": [
            {"role": "user", "content": "what is a bond?"},
            {"role": "assistant", "content": "A bond is a loan to an issuer."},
        ],
        "selectedText": "callable bonds can be redeemed",
    })
    assert req.history[0].role == "user"
    assert req.selected_text == "callable bonds can be redeemed"


def test_book_ask_request_history_and_selection_default_empty():
    req = BookAskRequest.model_validate({
        "question": "hi",
        "currentParagraphId": "p-1",
        "currentReadingOrder": 0,
    })
    assert req.history == []
    assert req.selected_text is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest backend/tests/test_book_ask_api.py -k history -v`
Expected: FAIL (`history` / `selectedText` not valid fields; `extra="forbid"`).

- [ ] **Step 3: Add the fields**

In `backend/app/retrieval/schemas.py`, add a turn model and extend the request:

```python
class ConversationTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class BookAskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    question: str = Field(min_length=1, max_length=1000)
    current_paragraph_id: str = Field(alias="currentParagraphId", min_length=1, max_length=160)
    current_reading_order: int = Field(alias="currentReadingOrder", ge=0)
    current_chapter_id: Optional[str] = Field(default=None, alias="currentChapterId", max_length=160)
    include_whole_book: bool = Field(default=False, alias="includeWholeBook")
    history: list[ConversationTurn] = Field(default_factory=list, max_length=40)
    selected_text: Optional[str] = Field(default=None, alias="selectedText", max_length=4000)
```

Ensure `Literal` is imported (it already is in this file).

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest backend/tests/test_book_ask_api.py -k history -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/schemas.py backend/tests/test_book_ask_api.py
git commit -m "feat(ask): accept conversation history and selected text"
```

---

### Task 2: Repository method to read paragraphs around the reading position

**Files:**
- Modify: `backend/app/retrieval/repository.py`
- Test: `backend/tests/integration/test_retrieval_repository.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/integration/test_retrieval_repository.py` (follow the fixtures already used there to seed a book + active index version + book_blocks):

```python
def test_read_context_window_returns_blocks_around_position(seeded_book_with_blocks):
    repo, user_id, book_id = seeded_book_with_blocks  # blocks at reading_order 0..20
    rows = repo.read_context_window(
        user_id=user_id, book_id=book_id, center_reading_order=10, radius=2,
    )
    orders = [r.reading_order for r in rows]
    assert orders == [8, 9, 10, 11, 12]


def test_read_context_window_clamps_at_start(seeded_book_with_blocks):
    repo, user_id, book_id = seeded_book_with_blocks
    rows = repo.read_context_window(
        user_id=user_id, book_id=book_id, center_reading_order=1, radius=3,
    )
    assert [r.reading_order for r in rows] == [0, 1, 2, 3, 4]
```

If `seeded_book_with_blocks` does not exist, add a fixture in this file that creates a `User`, `Book`, `IndexVersion` (status READY, set as `book.active_index_version_id`), and 21 `BookBlock` rows (reading_order 0..20, `text=f"para {i}"`), then yields `(RetrievalRepository(session_factory), user.id, book.id)`. Reuse the session factory fixture already present in this test module.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest backend/tests/integration/test_retrieval_repository.py -k read_context_window -v`
Expected: FAIL (`read_context_window` not defined). (Integration tests require Postgres; if unavailable they are skipped — in that case verify by code review and rely on Task 4 unit tests.)

- [ ] **Step 3: Implement the method**

Add a small dataclass and method to `backend/app/retrieval/repository.py`:

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class ContextBlock:
    paragraph_id: str
    reading_order: int
    text: str
    chapter_title: str | None


class RetrievalRepository:
    # ... existing methods ...

    def read_context_window(
        self,
        user_id: UUID,
        book_id: UUID,
        center_reading_order: int,
        radius: int = 2,
    ) -> list[ContextBlock]:
        lo = max(0, center_reading_order - radius)
        hi = center_reading_order + radius
        sql = text("""
            SELECT bb.paragraph_id, bb.reading_order, bb.text, bb.chapter_title
            FROM book_blocks bb
            JOIN index_versions iv ON iv.id = bb.index_version_id
            JOIN books b ON b.active_index_version_id = iv.id
            WHERE b.id = :book_id
              AND b.user_id = :user_id
              AND bb.reading_order BETWEEN :lo AND :hi
            ORDER BY bb.reading_order
        """)
        params = {"book_id": str(book_id), "user_id": str(user_id), "lo": lo, "hi": hi}
        with self._factory() as session:
            rows = session.execute(sql, params).fetchall()
        return [
            ContextBlock(paragraph_id=r[0], reading_order=r[1], text=r[2], chapter_title=r[3])
            for r in rows
        ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest backend/tests/integration/test_retrieval_repository.py -k read_context_window -v`
Expected: PASS (or SKIPPED if no Postgres — acceptable; covered by mocks in Task 4).

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/repository.py backend/tests/integration/test_retrieval_repository.py
git commit -m "feat(retrieval): add read_context_window for positional context"
```

---

### Task 3: Service helper that formats the current-context window

**Files:**
- Modify: `backend/app/retrieval/service.py`
- Test: `backend/tests/test_retrieval_service.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_retrieval_service.py` (this module already builds a `RetrievalService` with a fake repo — extend that fake to support `read_context_window`):

```python
def test_read_current_context_formats_window(make_service):
    from backend.app.retrieval.repository import ContextBlock
    service, fake_repo = make_service()
    fake_repo.context_blocks = [
        ContextBlock("p-9", 9, "Ninth paragraph.", "Chapter 1"),
        ContextBlock("p-10", 10, "Tenth paragraph.", "Chapter 1"),
    ]
    text_out = service.read_current_context(user_id=USER_ID, book_id=BOOK_ID, current_reading_order=10)
    assert "Ninth paragraph." in text_out
    assert "Tenth paragraph." in text_out
```

If `make_service` / fake repo do not yet exist in this module, add a fake repo class exposing `read_context_window(self, **kwargs)` returning `self.context_blocks`, plus `vector_search`/`keyword_search` returning `[]` by default, and a `make_service` helper that wires it into `RetrievalService`. Define module-level `USER_ID = uuid4()` and `BOOK_ID = uuid4()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest backend/tests/test_retrieval_service.py -k read_current_context -v`
Expected: FAIL (`read_current_context` not defined).

- [ ] **Step 3: Implement the method**

Add to `RetrievalService` in `backend/app/retrieval/service.py`:

```python
def read_current_context(
    self,
    user_id: UUID,
    book_id: UUID,
    current_reading_order: int,
    radius: int = 2,
) -> str:
    blocks = self._repo.read_context_window(
        user_id=user_id,
        book_id=book_id,
        center_reading_order=current_reading_order,
        radius=radius,
    )
    if not blocks:
        return "No surrounding text is available at the current position."
    return "\n\n".join(b.text for b in blocks)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest backend/tests/test_retrieval_service.py -k read_current_context -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/service.py backend/tests/test_retrieval_service.py
git commit -m "feat(retrieval): format current-context window for the agent"
```

---

### Task 4: The `BookAgent` tool-calling loop

**Files:**
- Create: `backend/app/retrieval/agent.py`
- Create: `backend/tests/test_book_agent.py`

The agent calls `client.responses.parse(model, instructions, input, tools, text_format=ModelBookAnswer)`. If the response contains `function_call` items it executes them, appends `function_call_output` items, and loops (max 3 rounds). When `output_parsed` is non-None it builds the final `BookAnswer`, validating citations against the source IDs accumulated from every `search_book` call.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_book_agent.py`:

```python
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import pytest

from backend.app.retrieval.agent import BookAgent, MAX_TOOL_ROUNDS
from backend.app.retrieval.answerer import ModelBookAnswer
from backend.app.retrieval.models import EvidenceItem, EvidenceSet

USER_ID = uuid4()
BOOK_ID = uuid4()


@dataclass
class FakeFunctionCall:
    name: str
    arguments: str
    call_id: str
    type: str = "function_call"


@dataclass
class FakeResponse:
    output: list
    output_parsed: Any


class FakeOpenAI:
    """Returns queued responses in order; records the inputs it was given."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.responses = self  # so .responses.parse works

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


def _evidence(source_id, text="evidence text"):
    return EvidenceItem(
        source_id=source_id, chunk_id=uuid4(), chunk_order=0, raw_text=text,
        start_reading_order=0, end_reading_order=1, chapter_id="c1",
        chapter_title="Chapter 1", page_start=1, page_end=1,
        paragraph_ids=["p-1"], source_refs=[{"source": "epub"}], rrf_score=1.0,
    )


class FakeRetrieval:
    def __init__(self):
        self.retrieve_calls = []
        self.evidence = EvidenceSet(items=[_evidence("s0-0")], supported=True)

    def retrieve(self, **kwargs):
        self.retrieve_calls.append(kwargs)
        return self.evidence

    def read_current_context(self, **kwargs):
        return "current page text"


def test_agent_runs_tool_then_answers_with_validated_citation():
    client = FakeOpenAI([
        FakeResponse(
            output=[FakeFunctionCall(name="search_book", arguments='{"query": "best strategy"}', call_id="c1")],
            output_parsed=None,
        ),
        FakeResponse(
            output=[],
            output_parsed=ModelBookAnswer(
                supported=True, eyebrow="Strategy", body="Start early.", citation_ids=["s0-0"],
            ),
        ),
    ])
    retrieval = FakeRetrieval()
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=retrieval)

    answer = agent.answer(
        user_id=USER_ID, book_id=BOOK_ID, question="best strategy?",
        history=[], selected_text=None, current_reading_order=10, include_whole_book=True,
    )

    assert answer.supported is True
    assert answer.body == "Start early."
    assert [s.id for s in answer.sources] == ["s0-0"]
    # search_book ran with max_reading_order=None because include_whole_book=True
    assert retrieval.retrieve_calls[0]["max_reading_order"] is None


def test_agent_applies_spoiler_cap_when_book_so_far():
    client = FakeOpenAI([
        FakeResponse(
            output=[FakeFunctionCall(name="search_book", arguments='{"query": "x"}', call_id="c1")],
            output_parsed=None,
        ),
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=["s0-0"])),
    ])
    retrieval = FakeRetrieval()
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=retrieval)
    agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                 selected_text=None, current_reading_order=42, include_whole_book=False)
    assert retrieval.retrieve_calls[0]["max_reading_order"] == 42


def test_agent_drops_invalid_citation_ids():
    client = FakeOpenAI([
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=["does-not-exist"])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    answer = agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                          selected_text=None, current_reading_order=0, include_whole_book=True)
    # cited an unknown id and no valid sources -> insufficient evidence
    assert answer.supported is False
    assert answer.sources == []


def test_agent_stops_at_round_cap():
    # Always returns a tool call -> would loop forever without the cap.
    looping = [
        FakeResponse(output=[FakeFunctionCall(name="search_book", arguments='{"query":"x"}', call_id=f"c{i}")],
                     output_parsed=None)
        for i in range(MAX_TOOL_ROUNDS + 2)
    ]
    # final forced answer
    looping.append(FakeResponse(output=[], output_parsed=ModelBookAnswer(
        supported=False, eyebrow="Insufficient evidence", body="", citation_ids=[])))
    client = FakeOpenAI(looping)
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    answer = agent.answer(user_id=USER_ID, book_id=BOOK_ID, question="q", history=[],
                          selected_text=None, current_reading_order=0, include_whole_book=True)
    assert answer.supported is False
    # exactly MAX_TOOL_ROUNDS tool-enabled calls + 1 forced final call
    assert len(client.calls) == MAX_TOOL_ROUNDS + 1


def test_agent_includes_history_and_selection_in_input():
    client = FakeOpenAI([
        FakeResponse(output=[], output_parsed=ModelBookAnswer(
            supported=True, eyebrow="E", body="B", citation_ids=[])),
    ])
    agent = BookAgent(client=client, model="gpt-5-mini", retrieval=FakeRetrieval())
    agent.answer(
        user_id=USER_ID, book_id=BOOK_ID, question="follow up",
        history=[{"role": "user", "content": "first q"}, {"role": "assistant", "content": "first a"}],
        selected_text="highlighted passage", current_reading_order=0, include_whole_book=True,
    )
    dumped = repr(client.calls[0]["input"])
    assert "first q" in dumped and "first a" in dumped and "highlighted passage" in dumped
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest backend/tests/test_book_agent.py -v`
Expected: FAIL (`backend.app.retrieval.agent` does not exist).

- [ ] **Step 3: Implement the agent**

Create `backend/app/retrieval/agent.py`:

```python
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Optional
from uuid import UUID

from .answerer import (
    ModelBookAnswer,
    _build_sources,
    _INSUFFICIENT_EVIDENCE_BODY,
    _INSUFFICIENT_EVIDENCE_EYEBROW,
)
from .models import BookAnswer, EvidenceItem, EvidenceSet
from .prompts import build_book_answer_prompt

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 3

SYSTEM_PROMPT = """\
You are a reading assistant answering questions about a single book, using only
evidence you retrieve with your tools. Decide which tool to use based on the question
and the conversation so far. Prefer the narrowest sufficient context.

Tools:
- read_current_context: the page the reader is currently on. Use for "this page", "here",
  or questions about what the reader is looking at right now.
- search_book: semantic + keyword search across the book. Use for broad or specific
  questions whose answer is not on the current page. Write a focused, standalone query
  (resolve pronouns from the conversation).

When you have enough evidence, answer. Set supported=false with an empty body if the
evidence does not support an answer. Cite only the source IDs present in search results.
Cite at most 3. Keep the body under 1200 characters."""

TOOLS = [
    {
        "type": "function",
        "name": "search_book",
        "description": "Semantic + keyword search across the book. Returns labeled evidence excerpts.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Standalone search query."}},
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "read_current_context",
        "description": "Return the text of the page the reader is currently on.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


class BookAgent:
    def __init__(self, client: Any, model: str, retrieval: Any,
                 reasoning_effort: Optional[str] = None, max_output_tokens: int = 700) -> None:
        self._client = client
        self._model = model
        self._retrieval = retrieval
        self._reasoning_effort = reasoning_effort
        self._max_output_tokens = max_output_tokens

    def answer(self, *, user_id: UUID, book_id: UUID, question: str,
               history: list[dict], selected_text: Optional[str],
               current_reading_order: int, include_whole_book: bool) -> BookAnswer:
        request_id = str(uuid.uuid4())
        max_reading_order = None if include_whole_book else current_reading_order
        evidence_by_id: dict[str, EvidenceItem] = {}
        input_items: list[Any] = self._build_input(history, question, selected_text)

        for round_index in range(MAX_TOOL_ROUNDS):
            response = self._call(input_items, with_tools=True)
            calls = [item for item in response.output if getattr(item, "type", None) == "function_call"]
            if not calls:
                return self._finalize(request_id, response.output_parsed, evidence_by_id)
            for call in calls:
                input_items.append(call)
                output = self._execute(call, user_id, book_id, current_reading_order,
                                       max_reading_order, round_index, evidence_by_id)
                input_items.append({
                    "type": "function_call_output", "call_id": call.call_id, "output": output,
                })

        # Round cap reached: force a final answer with no further tools.
        input_items.append({
            "role": "user",
            "content": "Answer now using the evidence gathered so far. Do not call any more tools.",
        })
        response = self._call(input_items, with_tools=False)
        return self._finalize(request_id, response.output_parsed, evidence_by_id)

    def _build_input(self, history: list[dict], question: str, selected_text: Optional[str]) -> list[Any]:
        items: list[Any] = []
        for turn in history:
            role = turn["role"] if isinstance(turn, dict) else turn.role
            content = turn["content"] if isinstance(turn, dict) else turn.content
            items.append({"role": role, "content": content})
        if selected_text:
            items.append({"role": "user",
                          "content": f"The reader highlighted this passage: \"{selected_text}\""})
        items.append({"role": "user", "content": question})
        return items

    def _call(self, input_items: list[Any], *, with_tools: bool):
        kwargs: dict[str, Any] = dict(
            model=self._model, instructions=SYSTEM_PROMPT, input=input_items,
            text_format=ModelBookAnswer, max_output_tokens=self._max_output_tokens,
        )
        if with_tools:
            kwargs["tools"] = TOOLS
        if self._reasoning_effort:
            kwargs["reasoning"] = {"effort": self._reasoning_effort}
        return self._client.responses.parse(**kwargs)

    def _execute(self, call, user_id, book_id, current_reading_order,
                 max_reading_order, round_index, evidence_by_id) -> str:
        try:
            if call.name == "read_current_context":
                return self._retrieval.read_current_context(
                    user_id=user_id, book_id=book_id, current_reading_order=current_reading_order)
            if call.name == "search_book":
                args = json.loads(call.arguments or "{}")
                query = args.get("query", "")
                evidence: EvidenceSet = self._retrieval.retrieve(
                    user_id=user_id, book_id=book_id, question=query,
                    include_whole_book=(max_reading_order is None),
                    current_reading_order=current_reading_order)
                lines = []
                for i, item in enumerate(evidence.items):
                    sid = f"s{round_index}-{i}"
                    # re-key the item so its source_id matches what the model sees
                    evidence_by_id[sid] = self._rekey(item, sid)
                    lines.append(f"[{sid}] {item.raw_text}")
                return "\n\n".join(lines) if lines else "No matching passages found."
            return f"Unknown tool: {call.name}"
        except Exception as exc:  # tool failure -> tell the model, let it recover
            logger.exception("tool %s failed", getattr(call, "name", "?"))
            return f"Tool error: {exc}"

    @staticmethod
    def _rekey(item: EvidenceItem, sid: str) -> EvidenceItem:
        from dataclasses import replace
        return replace(item, source_id=sid)

    def _finalize(self, request_id: str, parsed: Optional[ModelBookAnswer],
                  evidence_by_id: dict[str, EvidenceItem]) -> BookAnswer:
        if parsed is None or not parsed.supported:
            return BookAnswer(request_id=request_id, eyebrow=_INSUFFICIENT_EVIDENCE_EYEBROW,
                              body=_INSUFFICIENT_EVIDENCE_BODY, supported=False, sources=[])
        evidence = EvidenceSet(items=list(evidence_by_id.values()), supported=True)
        valid_ids = set(evidence_by_id.keys())
        sources = _build_sources(parsed.citation_ids, evidence, valid_ids)
        if not sources:
            return BookAnswer(request_id=request_id, eyebrow=_INSUFFICIENT_EVIDENCE_EYEBROW,
                              body=_INSUFFICIENT_EVIDENCE_BODY, supported=False, sources=[])
        return BookAnswer(request_id=request_id, eyebrow=parsed.eyebrow, body=parsed.body,
                          supported=True, sources=sources)
```

Note: `build_book_answer_prompt` is imported for parity but the agent builds its own input; remove the import if your linter flags it unused.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest backend/tests/test_book_agent.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/retrieval/agent.py backend/tests/test_book_agent.py
git commit -m "feat(ask): add agentic tool-calling BookAgent"
```

---

### Task 5: Wire `BookAgent` into the router

**Files:**
- Modify: `backend/app/routers/book_ask.py`
- Test: `backend/tests/test_book_ask_api.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_book_ask_api.py` (this module already builds a test client with a stubbed assistant/session — follow its existing pattern for an indexed, READY book and an authenticated request). The test patches the agent so no real OpenAI call happens:

```python
def test_ask_uses_book_agent(monkeypatch, ask_client_ready_book):
    client, book_id, auth_headers = ask_client_ready_book
    captured = {}

    from backend.app.retrieval.models import BookAnswer, BookSource
    def fake_answer(self, **kwargs):
        captured.update(kwargs)
        return BookAnswer(request_id="r1", eyebrow="E", body="B", supported=True,
                          sources=[BookSource(id="s0-0", paragraph_id="p-1", chapter_title="C",
                                              excerpt="ex", page_index=0, page_label=None,
                                              source_ref={"source": "epub"})])
    monkeypatch.setattr("backend.app.retrieval.agent.BookAgent.answer", fake_answer)

    resp = client.post(f"/library/books/{book_id}/ask", headers=auth_headers, json={
        "question": "best strategy?", "currentParagraphId": "p-1", "currentReadingOrder": 5,
        "includeWholeBook": True, "history": [{"role": "user", "content": "earlier"}],
        "selectedText": "passage",
    })
    assert resp.status_code == 200
    assert resp.json()["body"] == "B"
    assert captured["history"] == [{"role": "user", "content": "earlier"}]
    assert captured["selected_text"] == "passage"
    assert captured["include_whole_book"] is True
```

If `ask_client_ready_book` does not exist, add a fixture that builds the app test client with an authenticated user, a `Book` whose `active_index_version_id` points at a READY `IndexVersion`, and returns `(client, book_id, auth_headers)`. Reuse the auth-bypass / session fixtures already in `test_book_ask_api.py`.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest backend/tests/test_book_ask_api.py -k uses_book_agent -v`
Expected: FAIL (router still calls the old single-shot answerer; `history`/`selected_text` not forwarded).

- [ ] **Step 3: Rewire the router**

In `backend/app/routers/book_ask.py`, replace the `_build_answerer` usage in `ask_book` with the agent. Add:

```python
def _build_agent(request: Request):
    from openai import OpenAI
    from ..retrieval.agent import BookAgent
    settings = request.app.state.settings
    client = OpenAI(api_key=settings.openai_api_key)
    retrieval = _build_retrieval_service(request)
    return BookAgent(client=client, model=settings.openai_model, retrieval=retrieval,
                     reasoning_effort=settings.openai_reasoning_effort)
```

Then in `ask_book`, after the index-ready checks, replace the `retrieval_service.retrieve(...)` + `answerer.answer(...)` block with:

```python
    agent = _build_agent(request)
    answer = agent.answer(
        user_id=user.id,
        book_id=book_id,
        question=ask_request.question,
        history=[t.model_dump() for t in ask_request.history],
        selected_text=ask_request.selected_text,
        current_reading_order=ask_request.current_reading_order,
        include_whole_book=ask_request.include_whole_book,
    )

    return BookAskResponse(
        requestId=answer.request_id, eyebrow=answer.eyebrow, body=answer.body,
        supported=answer.supported,
        sources=[BookSourceResponse(
            id=s.id, paragraphId=s.paragraph_id, chapterTitle=s.chapter_title, excerpt=s.excerpt,
            pageIndex=s.page_index, pageLabel=s.page_label, sourceRef=s.source_ref,
        ) for s in answer.sources],
    )
```

Remove the now-unused `_build_answerer` and the early `retrieval_service.retrieve` / `evidence.supported` short-circuit (the agent owns retrieval now). Keep the book-ownership and index-READY guards exactly as they are.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest backend/tests/test_book_ask_api.py -v`
Expected: PASS (all, including the existing API tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/book_ask.py backend/tests/test_book_ask_api.py
git commit -m "feat(ask): route book questions through the agentic loop"
```

---

### Task 6: Extend the e2e flow test

**Files:**
- Modify: `backend/tests/e2e/test_book_rag_flow.py`

- [ ] **Step 1: Add a multi-turn assertion**

Extend the existing flow test so that, after the book is indexed and READY, it posts an ask with a non-empty `history` and a stubbed/patched `BookAgent.answer` (or a fake OpenAI client) and asserts: 200 OK, a non-empty `body`, and that `sources` IDs all appear in the agent's accumulated evidence. Follow the patching style already used in this module for OpenAI calls.

- [ ] **Step 2: Run the suite**

Run: `.venv/bin/python -m pytest backend/tests/ -q`
Expected: PASS (skips allowed only for Postgres-gated integration tests).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/e2e/test_book_rag_flow.py
git commit -m "test(e2e): cover multi-turn agentic ask"
```

---

## Phase 2 — Frontend (conversational UI)

Phase 2 consumes the Phase 1 contract. Run JS tests from the repo root: `npm test -- <pattern>`.

### Task 7: Add `conversation` to the library model + schema migration

**Files:**
- Modify: `src/rag/bookAskTypes.ts` (or wherever `BookSource` lives) — add `ConversationTurn`
- Modify: `App.tsx` (the `LibraryItem` type, `schemaVersion`, and the persistence migration)
- Test: add `src/library/conversation.test.ts` for the migration helper

- [ ] **Step 1: Write the failing test**

Create `src/library/conversation.test.ts`:

```ts
import { migrateLibraryItem } from './conversation';

test('migrates a v3 item by adding an empty conversation', () => {
  const v3 = { id: 'b1', schemaVersion: 3, savedInsights: [] } as any;
  const out = migrateLibraryItem(v3);
  expect(out.schemaVersion).toBe(4);
  expect(out.conversation).toEqual([]);
});

test('leaves an existing conversation untouched', () => {
  const v4 = { id: 'b1', schemaVersion: 4, conversation: [{ id: 't1', role: 'user', text: 'hi', createdAt: 'now' }] } as any;
  expect(migrateLibraryItem(v4).conversation).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- conversation`
Expected: FAIL (`./conversation` not found).

- [ ] **Step 3: Implement the type + migration**

Create `src/library/conversation.ts`:

```ts
import type { BookSource } from '../rag/bookAskTypes';

export type ConversationTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: BookSource[];
  createdAt: string;
};

export const LIBRARY_SCHEMA_VERSION = 4;

export function migrateLibraryItem<T extends { schemaVersion?: number; conversation?: ConversationTurn[] }>(
  item: T,
): T & { schemaVersion: number; conversation: ConversationTurn[] } {
  return {
    ...item,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    conversation: item.conversation ?? [],
  };
}
```

In `App.tsx`: add `conversation: ConversationTurn[]` to the `LibraryItem` type, import `migrateLibraryItem` + `LIBRARY_SCHEMA_VERSION`, set `schemaVersion: LIBRARY_SCHEMA_VERSION` everywhere a library item is created (currently `3`), and run `migrateLibraryItem` over each item in the load/hydrate path that currently reads persisted items.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- conversation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/library/conversation.ts src/library/conversation.test.ts App.tsx
git commit -m "feat(library): persist per-book conversation (schema v4)"
```

---

### Task 8: History builder with char-budget trimming

**Files:**
- Create: `src/rag/buildHistory.ts`
- Test: `src/rag/buildHistory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/rag/buildHistory.test.ts`:

```ts
import { buildHistory } from './buildHistory';
import type { ConversationTurn } from '../library/conversation';

const turn = (role: 'user' | 'assistant', text: string): ConversationTurn =>
  ({ id: Math.random().toString(), role, text, createdAt: 'now' });

test('maps turns to {role, content}', () => {
  const out = buildHistory([turn('user', 'q'), turn('assistant', 'a')], 10_000);
  expect(out).toEqual([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]);
});

test('drops oldest whole turns to stay within the char budget', () => {
  const turns = [turn('user', 'A'.repeat(100)), turn('assistant', 'B'.repeat(100)), turn('user', 'C'.repeat(100))];
  const out = buildHistory(turns, 150); // only the last turn fits
  expect(out).toEqual([{ role: 'user', content: 'C'.repeat(100) }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- buildHistory`
Expected: FAIL (`./buildHistory` not found).

- [ ] **Step 3: Implement**

Create `src/rag/buildHistory.ts`:

```ts
import type { ConversationTurn } from '../library/conversation';

export type ApiTurn = { role: 'user' | 'assistant'; content: string };

export const DEFAULT_HISTORY_CHAR_BUDGET = 6000;

export function buildHistory(turns: ConversationTurn[], budget = DEFAULT_HISTORY_CHAR_BUDGET): ApiTurn[] {
  const kept: ApiTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turns[i].text.length;
    if (used + cost > budget && kept.length > 0) break;
    kept.unshift({ role: turns[i].role, content: turns[i].text });
    used += cost;
  }
  return kept;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- buildHistory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rag/buildHistory.ts src/rag/buildHistory.test.ts
git commit -m "feat(ask): build token-bounded conversation history"
```

---

### Task 9: Send history + selectedText from the client

**Files:**
- Modify: `App.tsx` (the `requestBookAsk` function, ~line 1721)
- Test: `src/rag/bookAskApi.test.ts`

- [ ] **Step 1: Write the failing test**

If `requestBookAsk` is not yet extracted into `src/rag/bookAskApi.ts`, extract it there first (pure function taking `(args, fetchImpl)`), then test:

```ts
import { requestBookAsk } from './bookAskApi';

test('sends history and selectedText in the body', async () => {
  const calls: any[] = [];
  const fakeFetch = async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ requestId: 'r', eyebrow: 'E', body: 'B', supported: true, sources: [] }) } as any;
  };
  await requestBookAsk({
    apiBaseUrl: 'http://x', cloudBookId: 'b', question: 'q', currentParagraphId: 'p',
    currentReadingOrder: 3, includeWholeBook: true, accessToken: 't',
    history: [{ role: 'user', content: 'earlier' }], selectedText: 'sel',
  }, fakeFetch);
  expect(calls[0].history).toEqual([{ role: 'user', content: 'earlier' }]);
  expect(calls[0].selectedText).toBe('sel');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- bookAskApi`
Expected: FAIL (`history`/`selectedText` not in body, or function not extracted).

- [ ] **Step 3: Implement**

Extract/extend `requestBookAsk` so its body includes `history` and `selectedText`:

```ts
body: JSON.stringify({
  question, currentParagraphId, currentReadingOrder, includeWholeBook,
  history, selectedText,
}),
```

Update the `App.tsx` `runBookAsk` caller to pass `buildHistory(activeLibraryItem.conversation)` and the current `selectedText` (or `undefined`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- bookAskApi`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rag/bookAskApi.ts src/rag/bookAskApi.test.ts App.tsx
git commit -m "feat(ask): send conversation history and selection to backend"
```

---

### Task 10: Persist turns + stop destroying the thread on citation tap

**Files:**
- Modify: `App.tsx` (`runBookAsk`, `navigateToSource`, conversation state)
- Test: covered via a new `src/library/appendTurn.test.ts` for the pure append helper

- [ ] **Step 1: Write the failing test**

Create `src/library/appendTurn.test.ts`:

```ts
import { appendTurns } from './appendTurn';

test('appends a user question then an assistant answer with sources', () => {
  let convo = appendTurns([], { role: 'user', text: 'q' });
  convo = appendTurns(convo, { role: 'assistant', text: 'a', sources: [{ id: 's0-0' } as any] });
  expect(convo.map((t) => t.role)).toEqual(['user', 'assistant']);
  expect(convo[1].sources).toHaveLength(1);
  expect(new Set(convo.map((t) => t.id)).size).toBe(2); // unique ids
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- appendTurn`
Expected: FAIL (`./appendTurn` not found).

- [ ] **Step 3: Implement helper + wire into App**

Create `src/library/appendTurn.ts`:

```ts
import type { ConversationTurn } from './conversation';

export function appendTurns(
  convo: ConversationTurn[],
  ...turns: Array<Pick<ConversationTurn, 'role' | 'text'> & Partial<ConversationTurn>>
): ConversationTurn[] {
  const made = turns.map((t, i) => ({
    id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    sources: t.sources,
    role: t.role,
    text: t.text,
  }));
  return [...convo, ...made];
}
```

In `App.tsx`:
- In `runBookAsk`, on success append a `user` turn (the question) and an `assistant` turn (`{ text: result.body, sources: result.sources }`) to `activeLibraryItem.conversation` via `updateActiveLibraryItem` + `appendTurns`, so the thread persists.
- In `navigateToSource` (currently calls `clearSelection()`), **remove the `clearSelection()` call**. Replace with: set a `threadCollapsed` state to `true` and `updateReadingLocation` + `setScrollTarget` only. The conversation stays in `activeLibraryItem.conversation`; the panel collapses to the peek bar.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- appendTurn`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/library/appendTurn.ts src/library/appendTurn.test.ts App.tsx
git commit -m "feat(ask): persist turns; collapse (not destroy) thread on citation tap"
```

---

### Task 11: Conversation thread UI + entry points

**Files:**
- Create: `src/components/ConversationThread.tsx`
- Modify: `App.tsx` (footer entry button, "Ask" selection action opens the thread, render the thread + peek bar, remove the 4 scope chips from the ask flow)
- Test: `src/components/ConversationThread.test.tsx`

This is the visual task; match `docs/mockups/conversational-ask.html`. Keep the component presentational — it takes data + callbacks and renders; all state lives in `App.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/components/ConversationThread.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ConversationThread } from './ConversationThread';

const baseProps = {
  turns: [
    { id: 't1', role: 'user' as const, text: 'best strategy?', createdAt: 'now' },
    { id: 't2', role: 'assistant' as const, text: 'Start early.', createdAt: 'now',
      sources: [{ id: 's0-0', paragraphId: 'p-1', chapterTitle: 'Diversification', excerpt: 'ex',
                  pageIndex: 221, pageLabel: null, sourceRef: { source: 'epub' } }] },
  ],
  includeWholeBook: true, selectedText: undefined as string | undefined, isLoading: false,
  onSubmit: jest.fn(), onToggleWholeBook: jest.fn(), onClear: jest.fn(),
  onNavigateSource: jest.fn(), onClearSelection: jest.fn(), onClose: jest.fn(),
};

test('renders user and assistant turns with citation chips', () => {
  const { getByText } = render(<ConversationThread {...baseProps} />);
  getByText('best strategy?');
  getByText('Start early.');
  getByText('Diversification');
});

test('tapping a source calls onNavigateSource with the paragraph id', () => {
  const onNavigateSource = jest.fn();
  const { getByText } = render(<ConversationThread {...baseProps} onNavigateSource={onNavigateSource} />);
  fireEvent.press(getByText('Diversification'));
  expect(onNavigateSource).toHaveBeenCalledWith('p-1');
});

test('shows a context chip when selectedText is present', () => {
  const { getByText } = render(<ConversationThread {...baseProps} selectedText="callable bonds" />);
  getByText(/Asking about/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ConversationThread`
Expected: FAIL (`./ConversationThread` not found).

- [ ] **Step 3: Implement the component**

Create `src/components/ConversationThread.tsx` as a bottom-sheet presentational component matching the mockup: header (title, "Book so far/Whole book" toggle bound to `onToggleWholeBook`, clear button → `onClear`); a `ScrollView` of turns (user bubble for `role==='user'`; warm-note answer card with eyebrow/body + a horizontal `BookSources`-style citation row whose chips call `onNavigateSource(source.paragraphId)`; a per-answer Save is optional in v1); a context chip above the input when `selectedText` is set (✕ → `onClearSelection`); a `TextInput` + send calling `onSubmit(text)`; a "Thinking…" row when `isLoading`. Reuse the palette constants already in `App.tsx`/`BookSources.tsx`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ConversationThread`
Expected: PASS (3 passed).

- [ ] **Step 5: Wire into App.tsx and remove scope chips**

In `App.tsx`:
- Add a footer "Ask the book" entry that opens the thread with no selection (gated on `activeLibraryItem.wholeBookAi.status === 'ready'`, else open the existing WholeBookAiSheet setup).
- Make the selection "Ask" action open the same thread with `selectedText` set.
- Render `<ConversationThread>` (full) when open and not collapsed; render the peek bar when `threadCollapsed`; tapping the peek bar reopens.
- Remove the 4 scope chips and the old `AskSheet` scope row from the book-ask path. The Define/Example/Rephrase selection quick-actions stay untouched.

- [ ] **Step 6: Run the full JS suite + typecheck**

Run: `npm test` then `npm run typecheck`
Expected: PASS / 0 errors in changed files.

- [ ] **Step 7: Commit**

```bash
git add src/components/ConversationThread.tsx src/components/ConversationThread.test.tsx App.tsx
git commit -m "feat(ask): conversational thread UI with auto-scope (no scope chips)"
```

---

## Self-Review

**Spec coverage:**
- Conversational memory (per-book, on-device, across restarts) → Tasks 7, 8, 10.
- Auto-scope via tools, remove chips → Tasks 4, 5, 11.
- `search_book` + `read_current_context` tools → Tasks 2, 3, 4.
- Selection as ambient context → Tasks 4 (`_build_input`), 9, 11 (context chip).
- Spoiler toggle as flag → Tasks 4 (`max_reading_order`), 5, 9, 11.
- Citation validation reused → Task 4 (`_build_sources`).
- 3-round cap → Task 4.
- Char-budget history → Task 8.
- Citation tap collapses (not destroys) → Task 10.
- Stateless backend → no conversation store added (confirmed: history is request-only).
- Error handling (no-output, invalid citations, tool failure, round cap) → Task 4 tests.
- Tests across backend unit/API/e2e + frontend → Tasks 1–11.

**Placeholder scan:** Task 6 and Task 11 step 3/5 describe UI/e2e assembly in prose rather than full literal code, because they assemble against existing fixtures (`test_book_rag_flow.py` patching style) and the large `App.tsx` render tree / the mockup. All *logic* units (schema, repo, service, agent, history, migration, append, API body, component contract) have complete code and concrete tests. No `TODO`/`TBD` remain.

**Type consistency:** `ConversationTurn` ({id, role, text, sources?, createdAt}) is consistent across Tasks 7/8/10/11. `ApiTurn` ({role, content}) is what `buildHistory` emits and what the backend `ConversationTurn`/`history` accepts (Task 1). Source IDs are `s{round}-{i}` in Task 4 and asserted as such in tests. `BookAgent.answer(**kwargs)` signature matches the router call in Task 5 and the tests in Task 4.
