# Saved notes from the Ask thread as self-contained Q&A

## Problem

Saving an answer out of the Ask thread (long-press → Save, added in `dd421ba`) produces a note that
doesn't stand on its own. Two distinct causes, both visible in one device recording where the reader
saved the answer to a one-word follow-up, `example`:

**1. A retrieval artifact is presented as the reader's own selection.** `saveChatTurn` in `App.tsx`
sets `selectedText` from `turn.sources[0].excerpt` — the *first* of the answer's RAG citations, which
the backend produces as `item.raw_text[:200]` in `_build_sources` (`backend/app/retrieval/answerer.py`).
For the recorded note this surfaced a Chapter 7 p.175 chunk ("Only for College / If you use the money
from a college savings plan…") that the reader never chose. It is wrong on three counts: the reader
didn't select it, `[0]` is an arbitrary pick out of up to three citations, and it lands in the visual
slot that for a Highlight or an Explain note means *the text I selected* — so the note asserts a
provenance that never happened.

**2. A bare follow-up is not a question.** The saved note's headline was `example`. Its meaning lived
two turns earlier, in `Tell me more about "529 Plan", as discussed in this book and beyond.` A single
turn lifted out of a thread loses the context that made it comprehensible.

Underneath both is one modelling mistake: `SavedInsight` was designed for "reader selects text, AI
responds about that selection," and `dd421ba` forced a conversation turn into that shape by overloading
two existing fields — `eyebrow` became the question, `selectedText` became a citation. Overloaded
fields whose meaning depends on `action` are what allowed a citation to masquerade as a selection.

**Also fixed here:** saved answers render as raw Markdown. The thread renders through
`AnswerMarkdown`, but `SavedNotesSheet` and `SavedNoteEditorSheet` use a plain `<Text>`, so a saved
answer displays literal `- ` and `**` markup.

**Deliberately not fixed here:** answers contain internal source IDs in their prose (`(See s0-0.)`).
That is a backend prompt bug that affects the live thread too, so it gets its own fix and test rather
than being folded into a notes change.

## Design

A note saved from the thread is a **self-contained question-and-answer pair** — the unit that makes
sense alone, and the same unit the planned Anki/flashcard export needs.

### Data model

Two optional fields on `SavedInsight` (`App.tsx`). Both optional, so every note already persisted in
`reader-state.json` keeps loading unchanged and no migration or `LIBRARY_SCHEMA_VERSION` bump is
needed — the same additive precedent used for `archivedConversations` and `mindMapJob`:

```ts
question?: string;              // the self-contained question this note answers
citations?: SavedCitation[];    // all of the answer's sources, capped at 3

type SavedCitation = Omit<BookSource, 'id'>;
```

`SavedCitation` is `BookSource` (`src/rag/bookAskTypes.ts`) minus its `id`, which is a per-request
identifier (`s0-0`) that is meaningless once the request is over and would collide across notes.
Keeping every other field means the editor can render citations through the existing `BookSources`
component by mapping each entry to a `BookSource` with an index-derived key — no change to that shared
component, which the live thread also depends on.

Three invariants — these, not the new fields, are the actual fix:

1. **`selectedText` holds only text the reader selected.** Never a citation. Empty for a bare
   follow-up. This alone removes the fabricated provenance.
2. **`question` holds the question; `eyebrow` returns to meaning the AI's own short label.** No field's
   meaning depends on `action` any more.
3. **The display headline is `question || eyebrow`.** Thread notes title from their question; inline
   Explain/Example/Rephrase/Summarize notes and Highlights are untouched.

`isSavedInsight` accepts both new fields as optional, and rejects a malformed `citations` entry.

### Question composition

`saveChatTurn` resolves a self-contained question from the asking turn, found via the existing
`findPrecedingUserTurn`. `selectedText` and `contextParagraphId` live on the *user* turn, not the
assistant turn — the cause of an earlier bug fixed in `9f81033`.

Call a question **substantive** when, trimmed, it has ≥5 words or ≥30 characters. Then:

| Asking turn | `question` | `selectedText` |
|---|---|---|
| Has a real selection | verbatim | the selection |
| Substantive, no selection | verbatim | empty |
| Bare follow-up, no selection | composed (below) | empty |
| No asking turn found | the follow-up alone | empty |

Composition walks back to the most recent substantive user turn and forms `${subject} — ${followUp}`,
where `subject` is the first double-quoted phrase in that turn if present — matching straight (`"`) and
curly (`"` `"`) quotes, since templated questions are authored with straight quotes but text may arrive
curly — else that turn trimmed to 60 characters with a trailing ellipsis. The quoted-phrase case is the
common one because mind-map quick-asks are templated with the topic in quotes, so
`Tell me more about "529 Plan", as discussed in this book and beyond.` + `example` yields
**`529 Plan — example`**. No AI call, no added latency or cost.

Composition is a best-effort default, not a guarantee: an arbitrary typed follow-up has no quoted
subject to extract and will compose something merely serviceable. That is why the reader gets the last
word, below.

### Save flow

Saving from the thread saves immediately, then opens the note editor on the new note so the reader can
correct the question and add their own thought while it is fresh — the annotation that makes a note
worth studying later.

`editingNote` already renders last in the sheet stack (`App.tsx:4358`), after the thread (`4269`), so
the editor stacks above the open thread with no reordering. Closing it returns the reader to the
conversation.

`SavedNoteEditorSheet` gains a second editable field for `question`, shown only for notes that have
one. `onSave` writes both `question` and `userNote`; its enable condition widens so either field
changing enables Save.

### Rendering

| Surface | Question | Selection | Answer | Citations |
|---|---|---|---|---|
| Editor | editable title input | serif quote, only when genuine | `AnswerMarkdown` | tappable chips via `BookSources` |
| List | headline | only when genuine | flattened to plain text, 3-line clamp | existing chapter/page label |
| Export | `**Q:**` line | `>` blockquote | raw Markdown, unchanged | chapter/page list |

The list cannot use `AnswerMarkdown`: it renders a `View` per block, so `numberOfLines` cannot clamp
it. A new `flattenAnswerMarkdown` helper alongside `parseAnswerMarkdown`
(`src/components/parseAnswerMarkdown.ts`) joins parsed spans into plain text for previews, reusing the
existing parser rather than a second regex pass.

Export keeps raw Markdown because the artifact is a `.md` file, where `- ` and `**` are correct.

### Explicitly out of scope

- The `(See s0-0.)` source-ID leak in answer prose — separate backend prompt fix.
- Repairing notes already saved with a citation in `selectedText`. The defect was at write time; the
  reader's original selection was never recorded, so it cannot be recovered. Affected notes keep
  working and can be edited or re-saved.
- Any change to Highlight or inline Explain/Example/Rephrase/Summarize notes beyond Markdown rendering
  in shared surfaces. Their `selectedText` is already a genuine selection.
- Anki/flashcard export. This design makes notes the right shape for it; building it is separate.

## Testing

The load-bearing logic is deliberately pure functions, so it is unit-testable — unlike the long-press
menu interaction, which could not be tested via `fireEvent` in this RN version (noted in `dd421ba`).

- `composeNoteQuestion`: bare follow-up with a quoted subject composes `529 Plan — example`; the same
  with curly quotes composes identically; a substantive question passes through verbatim; a
  selection-anchored question passes through verbatim; empty history returns the follow-up alone; a
  non-quoted substantive subject is trimmed to 60 chars with an ellipsis.
- `flattenAnswerMarkdown`: bullet lists, numbered lists, and bold spans reduce to readable plain text
  with no residual `-`, `**`, or `1.` markup.
- Export formatting moves out of `App.tsx` into `src/library/savedNoteExport.ts` so it can be tested at
  all — today both formatters are private functions in a 7100-line file with no test file. The
  extracted module takes a note already reduced to display-ready labels, keeping `App.tsx`'s local
  `DocumentSourceRef`/`InsightAction` types and `formatSourceRef` out of it.

`isSavedInsight` is verified on device rather than by a unit test: it depends on `isDocumentSourceRef`,
`isRecord`, and `isFiniteNumber`, which serve many other `App.tsx` validators and are not worth
extracting for this change. A note the validator wrongly rejects vanishes from the list, so "pre-existing
notes still appear and open" is a sufficient and observable check.
- Export formatters: a thread note emits its `**Q:**` line and citation list; a note with no genuine
  selection emits no empty blockquote; a Highlight (no body) still emits no `**AI:**` line.

Manual on-device verification, since the save flow and sheet stacking have no test coverage:

1. In a thread, ask a substantive question, then a bare follow-up (`example`). Long-press the
   follow-up's answer → Save. Confirm the editor opens above the thread with a composed question, no
   citation posing as a selected passage, and the answer formatted rather than showing `**`.
2. Correct the question, add a note, Save. Confirm the notes list headline shows the corrected
   question.
3. Close the editor. Confirm the thread is still open underneath.
4. Tap a citation chip. Confirm it jumps to that passage in the book.
5. Save an answer to a question asked about a selection. Confirm the selection appears as the quoted
   passage.
6. Export. Confirm the `.md` contains the `**Q:**` line, the blockquote only where a real selection
   exists, and intact Markdown in the answer.
