# Hybrid quick-ask chips — design

Date: 2026-06-29
Branch: feature/book-mindmap

## Problem

The mind-map quick-ask chips inject ready-made questions into the "Ask the
book" thread. Every such question is answered by the hard-grounded `BookAgent`,
which is wired to use **only** retrieved book evidence and to refuse when the
book lacks the answer. As a result, a chip like **Examples** on a node such as
"Preferred Stocks" returns "not enough information" whenever the book itself
contains no worked examples — even though the model plainly knows real-world
examples. For a learning tool aimed at academic readers, that refusal is the
wrong behavior for example/explanatory intents.

## Decided behavior — the split

Each chip intent is classified as either **hybrid** (book evidence + clearly
labeled real-world general knowledge) or **grounded** (book-only, may refuse):

| Surface | Intent      | Mode     |
|---------|-------------|----------|
| Node    | `detail`    | hybrid   |
| Node    | `examples`  | hybrid   |
| Node    | `why`       | hybrid   |
| Chapter | `examples`  | hybrid   |
| Chapter | `takeaways` | grounded |
| Chapter | `argument`  | grounded |

Free-text Ask (the user typing their own question) and every other entry point
remain **grounded** — this is the default.

## Mechanism — explicit flag threaded through the stack

A single boolean, `allowGeneralKnowledge`, is decided at the chip (the only
place that knows the intent) and carried unchanged to the model's prompt. No
LLM intent-guessing.

```
mindmapQuickAsk.ts   intent → flag; builder returns { question, allowGeneralKnowledge }
tap sheets           pass (question, flag) to onQuickAsk
App.tsx / onQuickAsk  forward the flag
bookAskApi.ts         add allowGeneralKnowledge to the POST body
schemas.py            allow_general_knowledge: bool = False
book_ask.py           forward to agent.answer(..., allow_general_knowledge=...)
agent.py              if flag: hybrid system prompt + skip "no sources" refuse
```

Defaulting `allow_general_knowledge` to `False` means existing callers are
unaffected and stay strictly grounded.

## Component details

### Frontend — `src/rag/mindmapQuickAsk.ts`

Question builders change return type from `string` to:

```ts
interface QuickAsk { question: string; allowGeneralKnowledge: boolean; }
nodeQuickAskQuestion(node, intent): QuickAsk
chapterQuickAskQuestion(chapter, intent): QuickAsk
```

Flag is a static lookup on intent per the split table above.

### Frontend — tap sheets & `onQuickAsk`

`onQuickAsk` widens from `(question: string)` to
`(question: string, allowGeneralKnowledge: boolean)`. `NodeTapSheet` and
`ChapterTapSheet` already call the builder; they destructure and pass both
values through. `App.tsx`'s handler stores the flag on `pendingQuickAsk` and
forwards it into `runBookAsk`.

### Frontend — `src/rag/bookAskApi.ts`

Add `allowGeneralKnowledge?: boolean` to the request args and include it in the
POST body. Omitted → backend default `False`.

### Backend — `schemas.py`

`BookAskRequest` gains `allow_general_knowledge: bool = False` (camelCase alias
`allowGeneralKnowledge`, `populate_by_name=True` already set).

### Backend — `book_ask.py`

Forward `ask_request.allow_general_knowledge` into `agent.answer(...)`.

### Backend — `agent.py`

`BookAgent.answer(..., allow_general_knowledge: bool = False)`:

1. **Prompt selection.** When the flag is set, `_call` uses a new
   `HYBRID_SYSTEM_PROMPT` instead of the strict `SYSTEM_PROMPT`.
2. **Relaxed guard.** `_finalize` receives the flag. When set, it skips the
   `if not sources: refuse` branch — a labeled general-knowledge answer with no
   book citations is valid. The `not parsed.supported` guard is retained (the
   model may still genuinely abstain). Grounded mode is byte-for-byte unchanged.

Draft `HYBRID_SYSTEM_PROMPT`:

> You are a reading assistant. Answer the question by drawing on the book's
> evidence and, where helpful, real-world general knowledge.
> - Always search the book first and lead with what the book says.
> - You may add real-world examples or context beyond the book.
> - Clearly attribute each part: what comes from the book vs. general knowledge.
> - If the book has nothing relevant, you may still answer from general
>   knowledge — say so plainly.
> - Cite book source IDs only for claims drawn from the book.
> Keep the body under 1200 characters.

## Testing

- `mindmapQuickAsk.test.ts`: each intent returns the correct
  `allowGeneralKnowledge` value; existing assertions read `.question`.
- Tap-sheet tests: `onQuickAsk` called with `(question, flag)`.
- `BookAgent` tests: (a) hybrid prompt selected when flag true; (b) GK-only
  answer with empty sources returned (not refused) in hybrid mode; (c) grounded
  mode still refuses on empty sources (regression guard).
- Schema test: `allow_general_knowledge` defaults to `False` when omitted.

## Out of scope

- Changing free-text Ask behavior.
- Per-answer UI styling of the labeled sections (the prompt's inline labels are
  sufficient for now).
- Reworking retrieval/consolidation.
