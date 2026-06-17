# Conversational, Agentic Whole-Book Ask — Design

**Date:** 2026-06-17
**Status:** Approved design, pending implementation plan

## Summary

Turn the whole-book "Ask" feature from a single-shot, manually-scoped query into a
**conversational assistant** that **decides its own context scope** via tool calls.

Two user-facing changes:

1. **Conversation memory** — follow-up questions remember prior turns, per book, persisted
   on-device across app restarts.
2. **Automatic scope** — the four scope chips (Selection / Page / Chapter / Book) are removed.
   The model decides what context to pull. A single **"Book so far / Whole book"** toggle
   survives as a spoiler boundary.

The implementation is a thin **agentic tool-calling loop on the OpenAI Responses API**.
We explicitly do **not** adopt LangChain or LangGraph (see Rationale).

## Goals

- Multi-turn conversation with memory, scoped to a single book.
- Model-driven context selection (no manual scope picking).
- Reuse the existing RRF hybrid retrieval and citation-validation untouched.
- Keep the backend stateless; no conversation database.
- Preserve spoiler control via one toggle.

## Non-Goals

- Server-side conversation storage or cross-device sync (memory is on-device, single-device).
- LangChain / LangGraph adoption.
- Changes to the selection quick-actions (Define / Example / Rephrase on `/ai/assist`) — untouched.
- Spoiler handling beyond the existing reading-position cap exposed by the toggle.
- Streaming per-tool progress labels (deferred; v1 shows a generic "Thinking…" indicator).

## Rationale: why not LangChain/LangGraph

The backend already calls the OpenAI Responses API directly with structured outputs. The use
case is a single assistant with two tools and a short loop — the textbook case where LangGraph
is overkill (it earns its weight on complex multi-node graphs, branching/cycles, multi-agent,
or human-in-the-loop). Memory is per-book on the device, so there is nothing for LangChain's
server-side memory abstractions to manage — history arrives in the request. Adopting either
would add a large dependency tree and a new programming paradigm to wrap calls we already make
in a small amount of code.

## Architecture

The endpoint stays `POST /library/books/{book_id}/ask`. It evolves from
"retrieve-once-then-answer" into a bounded **tool-use loop** implemented in a new `BookAgent`
that sits between the router and the existing `RetrievalService` / answerer.

### Request contract

```jsonc
{
  "question": "string",
  "history": [{ "role": "user" | "assistant", "content": "string" }],
  "currentReadingOrder": 0,
  "currentParagraphId": "string?",      // optional
  "selectedText": "string?",            // present only when the reader highlighted text
  "includeWholeBook": true              // the surviving spoiler toggle
}
```

`history` carries the recent turns from the device (text only — no sources). The old
`scope`/chip fields are removed.

### Tools exposed to the model

1. **`search_book(query)`** — runs the existing `RetrievalService.retrieve()` (vector +
   keyword + RRF fusion). The model writes the `query` itself; this is where multi-turn
   **query reformulation** happens ("what about for retirees?" → it searches a standalone
   query). Returns chunks **with their source IDs**.
2. **`read_current_context()`** — returns the paragraphs around `currentReadingOrder` (the page
   the reader is on). Replaces the old Page/Chapter scopes. Always at-or-before the reading
   position, so inherently spoiler-safe.

**Selection is not a tool.** When `selectedText` is present it is injected into the prompt as
ambient context ("The reader highlighted: …"), since the model cannot request a selection the
user has not made.

### The loop

1. Build messages: system prompt + `history` + the new `question`; prepend `selectedText` as
   ambient context if present.
2. Call the model with the two tools registered.
3. If the model emits tool calls, execute them server-side and feed results back:
   - `search_book(query)` → `RetrievalService.retrieve(query, max_reading_order=…)`.
   - `read_current_context()` → paragraphs around `currentReadingOrder`.
4. Repeat until the model stops calling tools, **capped at 3 tool rounds**.
5. The model emits the final answer in the existing structured shape
   `{ supported, eyebrow, body, citation_ids }`.
6. `_build_sources` validates `citation_ids` against everything `search_book` returned this
   turn — **unchanged**.

### Spoiler boundary

The `includeWholeBook` flag sets `max_reading_order = None if includeWholeBook else
currentReadingOrder`, applied **server-side when `search_book` runs** — not left to the model.
The assistant therefore cannot spoil even if it writes a query about later chapters, because
the retrieval itself is capped. This reuses the existing `service.py` / `repository.py` logic.

## Memory model

Memory lives **on the device, per book**, by extending the existing `LibraryItem`
persistence (which already stores reading location, `wholeBookAi` state, and saved notes via
AsyncStorage).

```ts
// added to LibraryItem
conversation: {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: BookSource[];   // assistant turns only, for re-rendering citation chips
  createdAt: string;
}[];
```

- Schema bumps `3 → 4` with a trivial migration (existing books get `conversation: []`).
- **What is sent to the backend:** recent turns as `[{ role, content }]` — not the sources.
  Since there is no on-device tokenizer, history is bounded by a **character budget
  (~6 000 chars ≈ ~1 500 tokens)**, trimming **oldest whole turns** first so a half-turn is
  never sent. The current question is always included.
- **Lifecycle:** persists across restarts (rides along in the saved library item); a
  **"Clear conversation"** action resets it; cleared automatically when the book's index or
  the book is deleted.
- The backend never stores conversations — it is stateless and receives `history` per request.

## Frontend UX

### Entry points (one shared thread)

- **Standalone** — an "Ask the book" button in the reader footer opens the thread directly,
  no selection required.
- **From a highlight** — the existing "Ask" quick-action opens the same thread with the
  selected passage attached as a removable **context chip**.

### Thread panel (bottom sheet; replaces the scope-chip Ask sheet)

- Scrollable conversation: user questions as bubbles; each assistant answer rendered with
  `eyebrow` + `body` and its **citation chips inline beneath that answer**.
- Text input + send at the bottom.
- The **"Book so far / Whole book"** toggle in the panel header.
- A **"Clear conversation"** action.
- **Context chip** ("Asking about: …"): appears only when a selection is attached; removable
  via ✕; **sticky until removed** (every follow-up stays anchored to that passage until the
  user detaches it).

### Citation tap

Tapping a citation scrolls the book to that paragraph and **collapses the thread to a peek
bar** ("Conversation · N questions · Tap to reopen"), **without destroying it**. Reopening
restores the full conversation. `navigateToSource` will no longer call the nuclear
`clearSelection()`.

### Buttons and gating

- Follow-ups are typed, so the `Example / Simpler / Ask more` buttons retire **for this flow**.
  **Save** (into existing notes) is kept per assistant answer.
- The selection quick-actions (Define / Example / Rephrase) on `/ai/assist` are **unchanged**.
- The thread is available only when the book's index is `ready`; otherwise it routes to the
  existing "Enable Book AI" setup.
- While the agent runs, a "Thinking…" bubble shows.

A static mockup of both states (full thread + collapsed peek) lives at
`docs/mockups/conversational-ask.html`.

## Error handling

- **Round cap:** stop after 3 tool rounds and force a final answer (bounds latency/cost).
- **No / weak evidence:** reuse the existing `supported=false` → "Insufficient evidence" path.
- **No structured output:** the existing null-guard returns the insufficient-evidence card.
- **Tool execution failure:** reported back to the model as a tool-error message so it can
  recover or gracefully give up; if the whole turn fails, the thread shows an **error bubble
  and keeps the user's question** for retry — never destroys the conversation.
- **Network / auth errors:** caught in `runBookAsk`, rendered as an error bubble (reusing the
  401/503 handling).
- **Stale requests:** the existing `assistRequestId` guard cancels a turn when the user sends
  another question or closes.

## Testing

- **Backend unit (`BookAgent`):** mock the OpenAI client to emit tool calls → assert
  `search_book` / `read_current_context` run with correct args; assert the spoiler cap
  (`max_reading_order` set when `includeWholeBook=false`); citation IDs validated against
  retrieved sources; round-cap stops at 3; prior `history` reaches the model; no-output →
  insufficient-evidence.
- **API:** `/ask` with the new request shape; auth required; book-not-indexed → 409.
- **Frontend:** conversation persists to `LibraryItem` and survives reload (schema `3→4`
  migration); char-budget trimming drops oldest turns; citation tap collapses to peek without
  clearing the thread; context chip appears with a selection, is removable, and is sticky
  across follow-ups; standalone footer entry opens an empty thread.
- **e2e:** extend `test_book_rag_flow.py` — index → agentic ask → follow-up carrying history →
  assert scope routing and valid citations.

## Affected components

- **Backend:** new `backend/app/retrieval/agent.py` (`BookAgent`); `routers/book_ask.py`
  (request shape + agent wiring); `retrieval/schemas.py` (request fields). `RetrievalService`,
  `answerer`, RRF, and citation validation reused as-is.
- **Frontend:** `App.tsx` (footer entry, thread state, `navigateToSource` no longer clears,
  `runBookAsk` sends history/selectedText, conversation persistence + schema migration); a new
  conversation-thread component (likely replacing/augmenting the current `AskSheet` +
  `InsightCard` book-ask rendering); `LibraryItem` type + storage.
