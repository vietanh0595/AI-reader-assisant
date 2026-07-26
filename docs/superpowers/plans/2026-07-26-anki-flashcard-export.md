# Anki Flashcard Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader export their saved notes for the current book as an Anki-importable flashcard file, from the existing Saved Notes sheet.

**Architecture:** `ask`-thread notes already have a real question and answer, so they're turned into cards by pure string formatting, client-side, for free. Every other note type (`highlight`, `explain`, `example`, `rephrase`, `simpler`, `summarize`) has either no question or no answer at all, so those go through a new backend endpoint that reshapes them into a proper front/back pair with one OpenAI call — chunked and run concurrently so total latency doesn't grow with note count. The client merges the two card sources back into original note order and shares a plain tab-separated file, the same way it already shares the Markdown export.

**Tech Stack:** Backend: Python/FastAPI, the synchronous `openai` SDK's `responses.parse` structured-output call (no new dependency). Frontend: React Native/TypeScript, Jest, `expo-file-system` + `expo-sharing` (both already dependencies, already used by the Markdown export).

## Global Constraints

- **No new dependencies**, frontend or backend. `.apkg` (a real Anki package) is explicitly out of scope for this reason — it would require a SQLite-writing library this codebase doesn't have. Export is a plain tab-separated `.txt` file, which Anki imports natively via its own "Import File" screen.
- **`ask`-notes never reach the backend.** They already have a question and answer; only notes classified `needsAi` (everything else) are sent to `/notes/anki-cards`.
- **The AI is instructed to omit a note rather than force a bad card.** A `note_id` absent from the model's response means "skipped," not an error — the final deck may have fewer cards than notes considered, silently.
- **A failed AI call does not fail the whole export.** The `ask`-notes portion has no network dependency and still exports; only the notes that needed AI help are missing, and the reader is told so via an alert.
- **The endpoint is guest-usable and per-IP rate-limited**, matching `/ai/assist`'s posture — no sign-in required, but its own `SlidingWindowRateLimiter` instance (not shared with `/ai/assist`'s bucket).
- **One OpenAI call per chunk of 8 notes, run concurrently via `ThreadPoolExecutor`** (this codebase's OpenAI usage is the synchronous `OpenAI` client throughout, so real concurrency needs a thread pool). This mirrors `backend/app/mindmap/service.py`'s `_run_pipeline`, which parallelizes one call per chapter the same way — same `ThreadPoolExecutor` + `as_completed` idiom, same "a failed unit is skipped and logged, not fatal" behavior.
- **TSV escaping:** a card's `front`/`back` must never contain a literal tab or newline — both are stripped/collapsed to a single space before the line is written, so no card can corrupt the file's row structure.
- **No new App.tsx-level interaction tests** — this codebase's established pattern is to unit-test pure logic and verify UI flows on-device (see the precedent plan `docs/superpowers/plans/2026-07-25-thread-answer-note-model.md`, Task 7).

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `backend/app/anki_cards.py` | Request/response schemas, OpenAI structured-output schemas, chunked/parallel card generation | Create |
| `backend/tests/test_anki_cards.py` | Schema + generation-logic tests | Create |
| `backend/app/rate_limit.py` | New `check_anki_cards_rate_limit` dependency, separate limiter instance | Modify |
| `backend/app/routers/notes.py` | `POST /notes/anki-cards` endpoint | Create |
| `backend/app/main.py` | Register the new router | Modify |
| `backend/tests/test_notes_api.py` | Endpoint tests (rate limit, happy path via a monkeypatched generator) | Create |
| `src/library/ankiExport.ts` | Classification, TSV formatting/escaping, merge into final card list — pure, no App.tsx import | Create |
| `src/library/ankiExport.test.ts` | Tests for the above | Create |
| `src/library/ankiApi.ts` | `requestAnkiCards` — fetch wrapper for the new endpoint | Create |
| `src/library/ankiApi.test.ts` | Tests for the above | Create |
| `App.tsx` | `exportSavedInsightsAsAnki`, `promptNotesExportFormat`, wiring at the Saved Notes sheet's Export button | Modify |

`ankiExport.ts` and `ankiApi.ts` live in `src/library/` beside `savedNoteExport.ts`, which this mirrors directly: take display-ready, App.tsx-decoupled inputs, produce testable pure output, with `App.tsx` doing only the adapting.

---

### Task 1: Backend — chunked, parallel card generation

**Files:**
- Create: `backend/app/anki_cards.py`
- Test: `backend/tests/test_anki_cards.py`

**Interfaces:**
- Consumes: `openai.OpenAI` (constructed by the caller, Task 2), `backend.app.config.Settings` (not directly — model name and client are passed in, no settings import needed here).
- Produces:
  - `AnkiNoteInput(BaseModel)`: `note_id: str` (alias `noteId`), `action: Literal["highlight", "explain", "example", "rephrase", "simpler", "summarize"]`, `passage: Optional[str]`, `answer: Optional[str]`, `user_note: Optional[str]` (alias `userNote`).
  - `AnkiCardsRequest(BaseModel)`: `notes: list[AnkiNoteInput]` (1–200 items).
  - `AnkiCardResult(BaseModel)`: `note_id: str` (alias `noteId`), `front: str`, `back: str`.
  - `AnkiCardsResponse(BaseModel)`: `cards: list[AnkiCardResult]`.
  - `generate_anki_cards(client: OpenAI, model: str, notes: list[AnkiNoteInput]) -> list[AnkiCardResult]` — used by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_anki_cards.py`:

```python
from __future__ import annotations

from unittest.mock import MagicMock

from backend.app.anki_cards import (
    AnkiNoteInput,
    CardBatchResult,
    GeneratedCard,
    generate_anki_cards,
)


def _note(note_id: str, **overrides) -> AnkiNoteInput:
    defaults = dict(note_id=note_id, action="highlight", passage="A passage.", answer=None, user_note=None)
    defaults.update(overrides)
    return AnkiNoteInput(**defaults)


def _response_for(notes: list[AnkiNoteInput]) -> MagicMock:
    response = MagicMock()
    response.output_parsed = CardBatchResult(
        cards=[GeneratedCard(note_id=note.note_id, front=f"Q for {note.note_id}", back=f"A for {note.note_id}") for note in notes]
    )
    return response


def test_generates_one_card_per_note_within_a_single_chunk():
    notes = [_note("n1"), _note("n2")]
    client = MagicMock()
    client.responses.parse.return_value = _response_for(notes)

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert client.responses.parse.call_count == 1
    assert {card.note_id for card in cards} == {"n1", "n2"}


def test_splits_more_than_eight_notes_into_multiple_chunks():
    notes = [_note(f"n{i}") for i in range(10)]

    def fake_parse(**kwargs):
        # Identify which notes are in this call's input so chunking is verified
        # regardless of thread execution order.
        chunk_notes = [note for note in notes if note.note_id in kwargs["input"]]
        return _response_for(chunk_notes)

    client = MagicMock()
    client.responses.parse.side_effect = fake_parse

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert client.responses.parse.call_count == 2
    assert {card.note_id for card in cards} == {note.note_id for note in notes}


def test_omits_a_note_the_model_left_out_of_its_response():
    notes = [_note("n1"), _note("n2")]
    client = MagicMock()
    response = MagicMock()
    # The model only returned a card for n1 — n2 was too vague to quiz on.
    response.output_parsed = CardBatchResult(cards=[GeneratedCard(note_id="n1", front="Q", back="A")])
    client.responses.parse.return_value = response

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert [card.note_id for card in cards] == ["n1"]


def test_drops_a_card_whose_note_id_was_never_sent():
    notes = [_note("n1")]
    client = MagicMock()
    response = MagicMock()
    response.output_parsed = CardBatchResult(
        cards=[GeneratedCard(note_id="n1", front="Q", back="A"), GeneratedCard(note_id="hallucinated", front="Q2", back="A2")]
    )
    client.responses.parse.return_value = response

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    assert [card.note_id for card in cards] == ["n1"]


def test_a_failing_chunk_does_not_prevent_other_chunks_from_returning():
    notes = [_note(f"n{i}") for i in range(10)]

    def fake_parse(**kwargs):
        if "n0" in kwargs["input"]:
            raise RuntimeError("upstream failure")
        chunk_notes = [note for note in notes if note.note_id in kwargs["input"]]
        return _response_for(chunk_notes)

    client = MagicMock()
    client.responses.parse.side_effect = fake_parse

    cards = generate_anki_cards(client, "gpt-5-mini", notes)

    returned_ids = {card.note_id for card in cards}
    assert "n0" not in returned_ids
    assert len(returned_ids) == 8  # the other chunk's 8 notes all came back
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_anki_cards.py -v`
Expected: FAIL — cannot import `backend.app.anki_cards` (module does not exist yet).

- [ ] **Step 3: Implement the module**

Create `backend/app/anki_cards.py`:

```python
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Literal, Optional

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = logging.getLogger(__name__)

CHUNK_SIZE = 8
# Caps concurrent OpenAI calls per export the same way MAX_EXTRACTION_WORKERS
# caps mind-map chapter extraction (backend/app/mindmap/service.py) — enough
# parallelism to keep latency flat as note count grows, without fanning a large
# export into more simultaneous requests than is reasonable.
MAX_WORKERS = 8

AnkiNoteAction = Literal["highlight", "explain", "example", "rephrase", "simpler", "summarize"]


# --- API request/response schemas ---

class AnkiNoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    note_id: str = Field(alias="noteId", min_length=1, max_length=100)
    action: AnkiNoteAction
    passage: Optional[str] = Field(default=None, max_length=4000)
    answer: Optional[str] = Field(default=None, max_length=4000)
    user_note: Optional[str] = Field(default=None, alias="userNote", max_length=2000)

    @field_validator("passage", "answer", "user_note", mode="before")
    @classmethod
    def strip_text_fields(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class AnkiCardsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    notes: list[AnkiNoteInput] = Field(min_length=1, max_length=200)


class AnkiCardResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    note_id: str = Field(alias="noteId")
    front: str
    back: str


class AnkiCardsResponse(BaseModel):
    cards: list[AnkiCardResult]


# --- OpenAI structured-output schemas (internal, one chunk's worth of notes) ---

class GeneratedCard(BaseModel):
    note_id: str
    front: str = Field(max_length=300)
    back: str = Field(max_length=1000)


class CardBatchResult(BaseModel):
    cards: list[GeneratedCard]


_SYSTEM_PROMPT = """
You turn a reader's saved book notes into Anki flashcards. Each note has a
note_id and either a passage the reader highlighted, an AI explanation of a
passage, or both.

For each note, write a clear front/back flashcard:
- front: a specific, self-contained quiz question. Never just repeat the passage verbatim.
- back: the answer, in your own words, grounded only in the note's content.

If a note's content is too vague, generic, or fragmentary to support a real
quiz question, omit it from your output entirely — do not force a low-quality
card. Only include a note_id in your response for notes you actually turned
into a card.
""".strip()


def _build_user_input(notes: list[AnkiNoteInput]) -> str:
    lines: list[str] = []
    for note in notes:
        lines.append(f"note_id: {note.note_id}")
        lines.append(f"action: {note.action}")
        if note.passage:
            lines.append(f"passage: {note.passage}")
        if note.answer:
            lines.append(f"answer: {note.answer}")
        if note.user_note:
            lines.append(f"reader's own note: {note.user_note}")
        lines.append("")
    return "\n".join(lines)


def _generate_chunk(client: OpenAI, model: str, notes: list[AnkiNoteInput]) -> list[AnkiCardResult]:
    response = client.responses.parse(
        model=model,
        instructions=_SYSTEM_PROMPT,
        input=_build_user_input(notes),
        text_format=CardBatchResult,
        max_output_tokens=1500,
    )
    result: Optional[CardBatchResult] = response.output_parsed
    if result is None:
        return []

    valid_ids = {note.note_id for note in notes}
    return [
        AnkiCardResult(note_id=card.note_id, front=card.front, back=card.back)
        for card in result.cards
        if card.note_id in valid_ids
    ]


def generate_anki_cards(client: OpenAI, model: str, notes: list[AnkiNoteInput]) -> list[AnkiCardResult]:
    chunks = [notes[i : i + CHUNK_SIZE] for i in range(0, len(notes), CHUNK_SIZE)]
    cards: list[AnkiCardResult] = []

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(chunks))) as pool:
        futures = {pool.submit(_generate_chunk, client, model, chunk): chunk for chunk in chunks}
        for future in as_completed(futures):
            chunk = futures[future]
            try:
                cards.extend(future.result())
            except Exception:
                logger.warning(
                    "Anki card generation failed for a chunk of %d notes, skipping", len(chunk), exc_info=True
                )

    return cards
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_anki_cards.py -v`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/anki_cards.py backend/tests/test_anki_cards.py
git commit -m "feat(anki): chunked, parallel flashcard generation from saved notes"
```

---

### Task 2: Backend — `POST /notes/anki-cards` endpoint

**Files:**
- Modify: `backend/app/rate_limit.py`
- Create: `backend/app/routers/notes.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_notes_api.py`

**Interfaces:**
- Consumes: `AnkiCardsRequest`, `AnkiCardsResponse`, `generate_anki_cards` (Task 1); `get_client_ip`, `SlidingWindowRateLimiter` (existing, `backend/app/rate_limit.py`).
- Produces: `check_anki_cards_rate_limit(request: Request) -> None` (FastAPI dependency); `router` (`APIRouter`, mounted at `/notes`).

- [ ] **Step 1: Add a dedicated rate limiter**

In `backend/app/rate_limit.py`, add after `check_ai_assist_rate_limit`:

```python
ANKI_CARDS_RATE_LIMIT_MAX_REQUESTS = 20
ANKI_CARDS_RATE_LIMIT_WINDOW_SECONDS = 600.0  # 10 minutes

_anki_cards_limiter = SlidingWindowRateLimiter(
    max_requests=ANKI_CARDS_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=ANKI_CARDS_RATE_LIMIT_WINDOW_SECONDS,
)


def check_anki_cards_rate_limit(request: Request) -> None:
    client_ip = get_client_ip(request)
    if not _anki_cards_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests — please wait a few minutes and try again.",
        )
```

This is a separate limiter instance from `_ai_assist_limiter` — an export doesn't count against a reader's quick-action budget, and vice versa.

- [ ] **Step 2: Write the failing endpoint tests**

Create `backend/tests/test_notes_api.py`:

```python
from __future__ import annotations

from fastapi.testclient import TestClient


_VALID_PAYLOAD = {
    "notes": [{"noteId": "n1", "action": "highlight", "passage": "A passage from the book."}],
}


def test_the_21st_request_within_the_window_is_rate_limited(test_client: TestClient):
    statuses = [
        test_client.post("/notes/anki-cards", json=_VALID_PAYLOAD).status_code
        for _ in range(21)
    ]

    assert 429 not in statuses[:20]
    assert statuses[20] == 429


def test_returns_generated_cards(monkeypatch, test_client: TestClient):
    from backend.app.anki_cards import AnkiCardResult

    def fake_generate(client, model, notes):
        return [AnkiCardResult(note_id=notes[0].note_id, front="Q", back="A")]

    monkeypatch.setattr("backend.app.routers.notes.generate_anki_cards", fake_generate)

    response = test_client.post(
        "/notes/anki-cards",
        json={"notes": [{"noteId": "n1", "action": "explain", "passage": "p", "answer": "a"}]},
    )

    assert response.status_code == 200
    assert response.json() == {"cards": [{"noteId": "n1", "front": "Q", "back": "A"}]}


def test_rejects_an_empty_notes_list(test_client: TestClient):
    response = test_client.post("/notes/anki-cards", json={"notes": []})
    assert response.status_code == 422
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_notes_api.py -v`
Expected: FAIL — `404 Not Found` (route does not exist yet).

- [ ] **Step 4: Create the router**

Create `backend/app/routers/notes.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from openai import OpenAI

from ..anki_cards import AnkiCardsRequest, AnkiCardsResponse, generate_anki_cards
from ..rate_limit import check_anki_cards_rate_limit

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("/anki-cards", response_model=AnkiCardsResponse)
def anki_cards(
    ask_request: AnkiCardsRequest,
    request: Request,
    _rate_limit: None = Depends(check_anki_cards_rate_limit),
) -> AnkiCardsResponse:
    settings = request.app.state.settings
    client = OpenAI(api_key=settings.openai_api_key)
    cards = generate_anki_cards(client, settings.openai_model, ask_request.notes)
    return AnkiCardsResponse(cards=cards)
```

- [ ] **Step 5: Register the router**

In `backend/app/main.py`, add the import alongside the other router imports:

```python
from .routers.notes import router as notes_router
```

And register it alongside the other `include_router` calls:

```python
    app.include_router(notes_router)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_notes_api.py tests/test_anki_cards.py tests/test_ai_assist_rate_limit.py -v`
Expected: PASS — all tests, including the pre-existing `/ai/assist` rate-limit test (confirms the two limiters don't interfere with each other).

- [ ] **Step 7: Commit**

```bash
git add backend/app/rate_limit.py backend/app/routers/notes.py backend/app/main.py backend/tests/test_notes_api.py
git commit -m "feat(anki): add POST /notes/anki-cards endpoint"
```

---

### Task 3: Frontend — pure `ankiExport.ts` module

**Files:**
- Create: `src/library/ankiExport.ts`
- Test: `src/library/ankiExport.test.ts`

**Interfaces:**
- Consumes: `flattenAnswerMarkdown` from `../components/parseAnswerMarkdown` (existing, no App.tsx dependency).
- Produces:
  - `type AnkiSourceNote = { id: string; action: 'ask' | 'highlight' | 'explain' | 'example' | 'rephrase' | 'simpler' | 'summarize'; question: string; body: string; selectedText: string; userNote?: string }` — `question` is display-ready (already resolved to `question || eyebrow` by the App.tsx adapter in Task 5, same convention `ExportableNote` uses).
  - `type AnkiCard = { front: string; back: string }`
  - `type AnkiNoteInput = { noteId: string; action: Exclude<AnkiSourceNote['action'], 'ask'>; passage?: string; answer?: string; userNote?: string }` — re-exported for `ankiApi.ts` (Task 4) to consume, so the note-shaped-for-the-API type has one source of truth.
  - `classifyNoteForAnkiExport(note: AnkiSourceNote): 'formatted' | 'needsAi'`
  - `toAnkiNoteInput(note: AnkiSourceNote): AnkiNoteInput` — only ever called on a `needsAi`-classified note.
  - `formatAnkiCardLine(front: string, back: string): string`
  - `buildAnkiFile(cards: AnkiCard[]): string`
  - `buildCardsFromResults(notes: AnkiSourceNote[], aiResults: { noteId: string; front: string; back: string }[]): AnkiCard[]` — used by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `src/library/ankiExport.test.ts`:

```ts
import {
  buildAnkiFile,
  buildCardsFromResults,
  classifyNoteForAnkiExport,
  formatAnkiCardLine,
  toAnkiNoteInput,
  type AnkiSourceNote,
} from './ankiExport';

const note = (over: Partial<AnkiSourceNote> = {}): AnkiSourceNote => ({
  id: 'n1',
  action: 'ask',
  question: '',
  body: '',
  selectedText: '',
  ...over,
});

describe('classifyNoteForAnkiExport', () => {
  test('an ask note is pure formatting', () => {
    expect(classifyNoteForAnkiExport(note({ action: 'ask' }))).toBe('formatted');
  });

  test.each(['highlight', 'explain', 'example', 'rephrase', 'simpler', 'summarize'] as const)(
    '%s notes need AI',
    (action) => {
      expect(classifyNoteForAnkiExport(note({ action }))).toBe('needsAi');
    },
  );
});

describe('toAnkiNoteInput', () => {
  test('maps a passage and answer', () => {
    const input = toAnkiNoteInput(
      note({ id: 'n2', action: 'explain', selectedText: 'A passage.', body: 'An explanation.' }),
    );
    expect(input).toEqual({
      noteId: 'n2',
      action: 'explain',
      passage: 'A passage.',
      answer: 'An explanation.',
      userNote: undefined,
    });
  });

  test('omits empty passage and answer rather than sending empty strings', () => {
    const input = toAnkiNoteInput(note({ id: 'n3', action: 'highlight', selectedText: '', body: '' }));
    expect(input.passage).toBeUndefined();
    expect(input.answer).toBeUndefined();
  });

  test('carries the reader\'s own note through', () => {
    const input = toAnkiNoteInput(note({ id: 'n4', action: 'highlight', userNote: 'revisit this' }));
    expect(input.userNote).toBe('revisit this');
  });
});

describe('formatAnkiCardLine', () => {
  test('joins front and back with a tab', () => {
    expect(formatAnkiCardLine('Q', 'A')).toBe('Q\tA');
  });

  test('strips a literal tab out of a field', () => {
    expect(formatAnkiCardLine('Q\twith tab', 'A')).toBe('Q with tab\tA');
  });

  test('collapses an embedded newline to a space', () => {
    expect(formatAnkiCardLine('Q', 'Line one\nline two')).toBe('Q\tLine one line two');
  });

  test('collapses a Windows-style newline to a space', () => {
    expect(formatAnkiCardLine('Q', 'Line one\r\nline two')).toBe('Q\tLine one line two');
  });
});

describe('buildAnkiFile', () => {
  test('joins cards with newlines', () => {
    expect(buildAnkiFile([{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }])).toBe('Q1\tA1\nQ2\tA2');
  });

  test('returns an empty string for no cards', () => {
    expect(buildAnkiFile([])).toBe('');
  });
});

describe('buildCardsFromResults', () => {
  test('formats an ask note directly, ignoring aiResults', () => {
    const notes = [note({ id: 'n1', action: 'ask', question: 'What is X?', body: 'X is Y.' })];
    expect(buildCardsFromResults(notes, [])).toEqual([{ front: 'What is X?', back: 'X is Y.' }]);
  });

  test('flattens Markdown out of an ask note\'s answer', () => {
    const notes = [note({ id: 'n1', action: 'ask', question: 'Q', body: '- **one**\n- two' })];
    expect(buildCardsFromResults(notes, [])).toEqual([{ front: 'Q', back: 'one; two' }]);
  });

  test('skips an ask note with no question', () => {
    const notes = [note({ id: 'n1', action: 'ask', question: '', body: 'An answer.' })];
    expect(buildCardsFromResults(notes, [])).toEqual([]);
  });

  test('pulls a needsAi note\'s card from aiResults by noteId', () => {
    const notes = [note({ id: 'n2', action: 'highlight' })];
    const cards = buildCardsFromResults(notes, [{ noteId: 'n2', front: 'Generated Q', back: 'Generated A' }]);
    expect(cards).toEqual([{ front: 'Generated Q', back: 'Generated A' }]);
  });

  test('omits a needsAi note the AI result set has no entry for', () => {
    const notes = [note({ id: 'n2', action: 'highlight' })];
    expect(buildCardsFromResults(notes, [])).toEqual([]);
  });

  test('preserves original note order across mixed formatted and needsAi notes', () => {
    const notes = [
      note({ id: 'n1', action: 'highlight' }),
      note({ id: 'n2', action: 'ask', question: 'Q2', body: 'A2' }),
      note({ id: 'n3', action: 'explain' }),
    ];
    const cards = buildCardsFromResults(notes, [
      { noteId: 'n3', front: 'Q3', back: 'A3' },
      { noteId: 'n1', front: 'Q1', back: 'A1' },
    ]);
    expect(cards).toEqual([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
      { front: 'Q3', back: 'A3' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest ankiExport`
Expected: FAIL — cannot find module `./ankiExport`.

- [ ] **Step 3: Implement the module**

Create `src/library/ankiExport.ts`:

```ts
import { flattenAnswerMarkdown } from '../components/parseAnswerMarkdown';

export type AnkiNoteAction = 'highlight' | 'explain' | 'example' | 'rephrase' | 'simpler' | 'summarize';

// `question` is display-ready — already resolved to `question || eyebrow` by the App.tsx
// adapter, the same convention ExportableNote uses. This module never touches App.tsx types.
export type AnkiSourceNote = {
  id: string;
  action: 'ask' | AnkiNoteAction;
  question: string;
  body: string;
  selectedText: string;
  userNote?: string;
};

export type AnkiCard = { front: string; back: string };

export type AnkiNoteInput = {
  noteId: string;
  action: AnkiNoteAction;
  passage?: string;
  answer?: string;
  userNote?: string;
};

export type AnkiCardResult = { noteId: string; front: string; back: string };

// An `ask` note already has a real question and answer — pure formatting, no AI, no
// network call. Everything else has either no question (quick-actions) or no answer at
// all (a bare highlight), so it needs AI to turn it into a real quiz question.
export function classifyNoteForAnkiExport(note: AnkiSourceNote): 'formatted' | 'needsAi' {
  return note.action === 'ask' ? 'formatted' : 'needsAi';
}

// Only ever called on a `needsAi`-classified note, so `note.action` here excludes 'ask'.
export function toAnkiNoteInput(note: AnkiSourceNote): AnkiNoteInput {
  return {
    noteId: note.id,
    action: note.action as AnkiNoteAction,
    passage: note.selectedText || undefined,
    answer: note.body || undefined,
    userNote: note.userNote,
  };
}

function formatAskNoteAsCard(note: AnkiSourceNote): AnkiCard | null {
  const front = note.question.trim();
  const back = flattenAnswerMarkdown(note.body).trim();
  return front && back ? { front, back } : null;
}

export function formatAnkiCardLine(front: string, back: string): string {
  return `${escapeField(front)}\t${escapeField(back)}`;
}

function escapeField(value: string): string {
  return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

export function buildAnkiFile(cards: AnkiCard[]): string {
  return cards.map((card) => formatAnkiCardLine(card.front, card.back)).join('\n');
}

// Merges the two card sources back into the notes' original order: `ask` notes formatted
// directly, everything else matched back to its AI-generated card by noteId. A noteId with
// no entry in aiResults means the model chose to skip that note — it is silently omitted,
// not an error.
export function buildCardsFromResults(notes: AnkiSourceNote[], aiResults: AnkiCardResult[]): AnkiCard[] {
  const aiByNoteId = new Map(aiResults.map((result) => [result.noteId, result]));
  const cards: AnkiCard[] = [];

  for (const note of notes) {
    if (classifyNoteForAnkiExport(note) === 'formatted') {
      const card = formatAskNoteAsCard(note);
      if (card) {
        cards.push(card);
      }
      continue;
    }

    const aiCard = aiByNoteId.get(note.id);
    if (aiCard && aiCard.front.trim() && aiCard.back.trim()) {
      cards.push({ front: aiCard.front.trim(), back: aiCard.back.trim() });
    }
  }

  return cards;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest ankiExport`
Expected: PASS — every test in the new file.

- [ ] **Step 5: Commit**

```bash
git add src/library/ankiExport.ts src/library/ankiExport.test.ts
git commit -m "feat(anki): pure classification, TSV formatting, and card merging"
```

---

### Task 4: Frontend — `ankiApi.ts`

**Files:**
- Create: `src/library/ankiApi.ts`
- Test: `src/library/ankiApi.test.ts`

**Interfaces:**
- Consumes: `AnkiNoteInput`, `AnkiCardResult` (Task 3).
- Produces: `requestAnkiCards(args: { apiBaseUrl: string; notes: AnkiNoteInput[] }, fetchImpl?: FetchLike): Promise<AnkiCardResult[]>` — used by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `src/library/ankiApi.test.ts`:

```ts
import { requestAnkiCards } from './ankiApi';
import type { AnkiNoteInput } from './ankiExport';

const note: AnkiNoteInput = { noteId: 'n1', action: 'highlight', passage: 'A passage.' };

test('posts to the anki-cards endpoint with the notes payload', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fakeFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    return { ok: true, status: 200, json: async () => ({ cards: [] }) };
  };

  await requestAnkiCards({ apiBaseUrl: 'http://x', notes: [note] }, fakeFetch);

  expect(calls[0].url).toBe('http://x/notes/anki-cards');
  expect(calls[0].body).toEqual({ notes: [note] });
});

test('returns the cards from a successful response', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ cards: [{ noteId: 'n1', front: 'Q', back: 'A' }] }),
  });

  const cards = await requestAnkiCards({ apiBaseUrl: 'http://x', notes: [note] }, fakeFetch);

  expect(cards).toEqual([{ noteId: 'n1', front: 'Q', back: 'A' }]);
});

test('throws on a non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

  await expect(requestAnkiCards({ apiBaseUrl: 'http://x', notes: [note] }, fakeFetch)).rejects.toThrow(
    'Anki card generation failed with status 500.',
  );
});

test('ignores a malformed card entry rather than throwing', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ cards: [{ noteId: 'n1', front: 'Q', back: 'A' }, { noteId: 'n2' }] }),
  });

  const cards = await requestAnkiCards({ apiBaseUrl: 'http://x', notes: [note] }, fakeFetch);

  expect(cards).toEqual([{ noteId: 'n1', front: 'Q', back: 'A' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest ankiApi`
Expected: FAIL — cannot find module `./ankiApi`.

- [ ] **Step 3: Implement the module**

Create `src/library/ankiApi.ts`:

```ts
import type { AnkiCardResult, AnkiNoteInput } from './ankiExport';

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function requestAnkiCards(
  args: { apiBaseUrl: string; notes: AnkiNoteInput[] },
  fetchImpl: FetchLike = fetch,
): Promise<AnkiCardResult[]> {
  const url = `${args.apiBaseUrl}/notes/anki-cards`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: args.notes }),
  });

  if (!response.ok) {
    throw new Error(`Anki card generation failed with status ${response.status}.`);
  }

  const data: unknown = await response.json();

  if (!isRecord(data) || !Array.isArray(data.cards)) {
    throw new Error('Anki cards response was not in the expected format.');
  }

  return data.cards.filter(isAnkiCardResult);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAnkiCardResult(value: unknown): value is AnkiCardResult {
  return (
    isRecord(value) &&
    typeof value.noteId === 'string' &&
    typeof value.front === 'string' &&
    typeof value.back === 'string'
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest ankiApi`
Expected: PASS — every test in the new file.

- [ ] **Step 5: Commit**

```bash
git add src/library/ankiApi.ts src/library/ankiApi.test.ts
git commit -m "feat(anki): add requestAnkiCards API call"
```

---

### Task 5: `App.tsx` — wire up the export flow

**Files:**
- Modify: `App.tsx` — imports, new `exportSavedInsightsAsAnki`, new `promptNotesExportFormat`, the Saved Notes sheet's Export button call site.

**Interfaces:**
- Consumes: `classifyNoteForAnkiExport`, `toAnkiNoteInput`, `buildCardsFromResults`, `buildAnkiFile`, `type AnkiSourceNote` (Task 3); `requestAnkiCards` (Task 4); existing `getSavedNoteHeadline`, `slugifyForFileName`, `apiBaseUrl`, `notesExportPending`/`setNotesExportPending`, `Sharing`, `FileSystem`, `Alert`.
- Produces: no new exported interfaces — this is the orchestration layer.

- [ ] **Step 1: Add the imports**

Add to `App.tsx`'s import block, alongside the other `src/library/` imports:

```ts
import {
  buildAnkiFile,
  buildCardsFromResults,
  classifyNoteForAnkiExport,
  toAnkiNoteInput,
  type AnkiCardResult,
  type AnkiSourceNote,
} from './src/library/ankiExport';
import { requestAnkiCards } from './src/library/ankiApi';
```

- [ ] **Step 2: Add `exportSavedInsightsAsAnki`**

Add directly after `exportSavedInsights` (`App.tsx`, currently ending around line 3794 — search for `async function exportSavedInsights()` to locate it):

```ts
  async function exportSavedInsightsAsAnki() {
    if (savedInsights.length === 0 || notesExportPending) {
      return;
    }

    setNotesExportPending(true);

    try {
      const sourceNotes: AnkiSourceNote[] = savedInsights.map((note) => ({
        id: note.id,
        action: note.action,
        question: getSavedNoteHeadline(note),
        body: note.body,
        selectedText: note.selectedText,
        userNote: note.userNote,
      }));

      const needsAiNotes = sourceNotes.filter((note) => classifyNoteForAnkiExport(note) === 'needsAi');
      let aiResults: AnkiCardResult[] = [];

      if (needsAiNotes.length > 0) {
        try {
          aiResults = await requestAnkiCards({
            apiBaseUrl,
            notes: needsAiNotes.map(toAnkiNoteInput),
          });
        } catch (error) {
          // The ask-note cards below have no network dependency and still export —
          // only the notes that needed AI help are missing from this deck.
          Alert.alert(
            'Some notes skipped',
            'Your Q&A notes will still export, but the rest could not be turned into flashcards right now.',
          );
        }
      }

      const cards = buildCardsFromResults(sourceNotes, aiResults);

      if (cards.length === 0) {
        Alert.alert('Nothing to export', 'No saved notes could be turned into flashcards.');
        return;
      }

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        throw new Error('Sharing is not available on this device.');
      }

      const fileUri = `${FileSystem.cacheDirectory}${slugifyForFileName(currentBook.title)}-anki.txt`;
      await FileSystem.writeAsStringAsync(fileUri, buildAnkiFile(cards));
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/plain',
        dialogTitle: 'Export to Anki',
      });
    } catch (error) {
      Alert.alert('Export failed', 'Could not export flashcards. Please try again.');
    } finally {
      setNotesExportPending(false);
    }
  }

  function promptNotesExportFormat() {
    if (savedInsights.length === 0 || notesExportPending) {
      return;
    }

    Alert.alert('Export saved notes', 'Choose a format.', [
      { text: 'Markdown', onPress: () => void exportSavedInsights() },
      { text: 'Anki flashcards', onPress: () => void exportSavedInsightsAsAnki() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
```

- [ ] **Step 3: Wire the Export button to the new choice**

Find the `SavedNotesSheet` usage (search for `onExportNotes={() => void exportSavedInsights()}`) and change it to:

```tsx
                  onExportNotes={promptNotesExportFormat}
```

`SavedNotesSheet`'s own prop signature (`onExportNotes: () => void`) does not change — only what it's wired to at this call site.

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npx jest`
Expected: typecheck clean, every suite PASS.

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "feat(anki): wire Anki flashcard export into the Saved Notes sheet"
```

---

### Task 6: On-device verification

Backend request/response shape and the frontend's pure logic have automated coverage; the actual export tap → share sheet → real Anki import round trip does not, consistent with this codebase's established pattern of verifying UI/OS-integration flows manually (see the precedent plan's Task 7).

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Start the backend with a real OpenAI key configured**

Confirm `OPENAI_API_KEY` is set in the backend's local environment before starting it — the endpoint makes a real OpenAI call.

- [ ] **Step 2: Verify a mixed export**

In a book with at least one saved `ask`-thread note, one `highlight`, and one quick-action note (Explain/Example/Rephrase/Summarize/"Make it simpler"), open Saved Notes and tap **Export**. Choose **Anki flashcards**.

Confirm:
- The share sheet opens with a `.txt` file (not `.md`).
- No alert about skipped notes appears (all three notes had enough content to produce a card).

- [ ] **Step 3: Verify the file imports into Anki**

AirDrop or otherwise transfer the exported `.txt` to a device with Anki installed (or the Anki desktop app). Use **File → Import** (desktop) or the share-into-Anki flow (mobile). Confirm:
- Anki recognizes it as a tab-separated Front/Back import with no manual reformatting needed.
- The `ask` note's card front is the original question, verbatim.
- The other notes' cards are real quiz questions, not just the passage repeated as the front.

- [ ] **Step 4: Verify the empty/all-skipped path**

Temporarily disconnect the backend from the internet (or point `EXPO_PUBLIC_API_BASE_URL` at an unreachable host) and export a book that has at least one non-`ask` note and no `ask` notes. Confirm the "Some notes skipped" alert appears, followed by "Nothing to export" (since there were no `ask` notes to fall back on) rather than a share sheet with an empty file.

Restore the correct API base URL afterward.

- [ ] **Step 5: Verify the partial-fallback path**

With the backend reachable again, export a book that has both an `ask` note and a non-`ask` note, but temporarily make the anki-cards endpoint fail (e.g. stop the backend process right after tapping Export, or temporarily misconfigure `OPENAI_API_KEY` on the backend). Confirm the "Some notes skipped" alert appears and the share sheet still opens with a file containing just the `ask` note's card.

- [ ] **Step 6: Update the release-plan checklist**

Add a line to "Feature improvements / additions" in `/Users/vietanh0495/Documents/Obsidian Vault/projects/Book Reading App - Release Plan.md`, replacing the existing open `- [ ] Anki/flashcard export...` bullet with a `- [x]` entry summarizing what shipped: `ask`-notes formatted for free, everything else reshaped by a chunked/parallel AI call that can skip a note rather than force a bad card, plain-text TSV import (no `.apkg`), guest-usable and rate-limited like `/ai/assist`.
