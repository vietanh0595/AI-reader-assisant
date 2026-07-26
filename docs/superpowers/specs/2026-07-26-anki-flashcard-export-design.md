# Anki flashcard export from saved notes

## Problem

The release-plan backlog calls out Anki/flashcard export as the strongest unbuilt idea for the
academic audience this app targets: cheap to build, no organic-growth cost, and a natural fit for
communities (r/Anki, r/medicalschool, r/GradSchool) that already live inside spaced-repetition
study tools. Today a reader who wants their saved notes as Anki cards has to retype every one by
hand into Anki's editor — the app captures good study material (questions, AI explanations,
highlighted passages) but has no path to get it into the tool readers already use to actually
memorize it.

Saved notes aren't uniformly shaped, though. An `ask`-thread note already has a real question and
answer (`SavedInsight.question` / `.body`). A quick-action note (`explain`, `example`, `rephrase`,
`simpler`, `summarize`) has a passage and an AI response, but no question — the response answers an
implicit "explain this," not something a flashcard can quiz you on directly. A `highlight` note has
neither: just the passage the reader marked, with no AI content at all. A pure-formatting export
can produce a clean card for the first case, but would have to fake a question for the second and
has nothing to work with at all for the third.

## Design

### Scope (v1)

Export the *current book's* saved notes as an Anki-importable flashcard file, reachable from the
Saved Notes sheet. All notes for the book are considered, ignoring whatever filter/search is
currently active in the sheet — the same "export everything" convention the existing Markdown/copy
export already uses.

### Classification: reusing `action`, not adding a field

`SavedInsight.action` is already a fixed literal union (`'ask' | 'highlight' | 'explain' |
'example' | 'rephrase' | 'simpler' | 'summarize'`) set once at note-creation time by whichever flow
saved the note. That is exactly the discriminant flashcard export needs — no new field, no change
to how notes get created:

| `action` | Has a question? | Has an AI answer? | Route |
|---|---|---|---|
| `ask` | yes (`question`, or `eyebrow` for legacy notes) | yes (`body`) | pure formatting |
| `highlight` | no | no (empty `body`) | AI (generate from scratch) |
| `explain`, `example`, `rephrase`, `simpler`, `summarize` | no (only a passage) | yes (`body`) | AI (reshape into a question) |

### Card mapping

- **`ask` notes** (pure formatting, no AI, no network call): front = `question` (falling back to
  `eyebrow` for a legacy note saved before the `question` field existed — same fallback
  `toExportableNote` already uses). Back = `body` flattened to plain text via the existing
  `flattenAnswerMarkdown` (`src/components/parseAnswerMarkdown.ts`) — a flashcard's back is a plain
  text field, not Markdown, so this reuses the flattener already built for note-list previews
  rather than inventing a second one.
- **Everything else** (`highlight`, `explain`, `example`, `rephrase`, `simpler`, `summarize`): sent
  to a batched AI endpoint (below) with whatever context the note has (`selectedText`, `body`,
  `userNote`), which returns a front/back pair reshaped into an actual quiz question. The model is
  instructed to **omit** a note entirely if its content doesn't support a good question rather than
  force one — the resulting deck may have fewer cards than notes considered, silently (no error, no
  placeholder card).

### Backend: `POST /notes/anki-cards`

Accepts only the notes that need AI help — the client never sends `ask` notes here, since those are
formatted client-side with no network dependency:

```
POST /notes/anki-cards
{
  "notes": [
    { "noteId": "...", "action": "explain", "passage": "...", "answer": "...", "userNote": "..." },
    { "noteId": "...", "action": "highlight", "passage": "..." }
  ]
}

-> { "cards": [ { "noteId": "...", "front": "...", "back": "..." } ] }
```

A `noteId` present in the request but absent from the response means the model chose to skip that
note.

**Parallelism:** the endpoint chunks the incoming notes into groups (8 notes per chunk) and issues
one OpenAI call per chunk, run concurrently via a thread pool (`asyncio.gather` over
`asyncio.to_thread(...)` calls — this codebase's OpenAI usage is the synchronous `OpenAI` client,
per `backend/app/routers/book_ask.py` and `backend/app/retrieval/agent.py`, so true concurrency
needs a thread pool rather than `AsyncOpenAI`). Results are merged server-side before the single
`{cards: [...]}` response goes back to the client. This keeps wall-clock latency close to the
slowest chunk rather than growing with total note count, and keeps the client-facing contract a
single request/response with no partial-result handling on-device.

No book retrieval, citations, or `BookAgent` involvement — this is a rewriting task on data the
client already has, not a question about the book, so it doesn't touch the whole-book-AI retrieval
stack at all. Same shape as the mind-map consolidation call: one structured prompt, JSON in and
out.

**Access:** guest-usable, per-IP rate-limited, following the same posture as `/ai/assist` rather
than requiring sign-in. A guest can already save highlights and use quick-actions without an
account, so gating export behind sign-in would be a new, inconsistent restriction on notes they
already own locally.

### Frontend

- **`src/library/ankiExport.ts`** (new, pure module, no App.tsx imports — same shape as
  `src/library/savedNoteExport.ts`):
  - `classifyNoteForAnkiExport(note)` → `'formatted' | 'needsAi'`, per the table above.
  - `formatAnkiCardLine(front, back)` → a single TSV line, stripping literal tabs and collapsing
    embedded newlines out of `front`/`back` (a TSV field can't contain either without corrupting
    the file's structure).
  - `buildAnkiFile(cards)` → joins lines with `\n`.
- **New API function** (e.g. `src/library/ankiApi.ts`) calling `/notes/anki-cards`, following the
  same `fetch`-wrapping pattern as `requestBookAsk` in `src/rag/bookAskApi.ts`.
- **`App.tsx`**: new `exportSavedInsightsAsAnki()`, parallel to the existing
  `exportSavedInsightsAsMarkdown()`. The Saved Notes sheet's single "Export" button becomes a small
  choice between "Export Markdown" and "Export to Anki," since there are now two output shapes from
  the same note set.

### Data flow

1. Reader taps "Export to Anki" in the Saved Notes sheet.
2. Client classifies the book's saved notes into `formatted` (`ask`) and `needsAi` (everything
   else) buckets.
3. If `needsAi` is non-empty, POST it to `/notes/anki-cards` and await `{cards}`.
4. Merge, preserving original note order: `ask` notes formatted directly; other notes matched back
   by `noteId` from the response (unmatched `noteId`s are silently omitted — the "model skipped
   this" case).
5. Build the TSV text, write it to a temp file via `expo-file-system`, hand it to the native share
   sheet via `expo-sharing` — the same mechanism the Markdown export already uses. Anki's built-in
   "Import File" screen handles a plain tab-separated file directly; the reader names the deck
   during that import step.
6. Same `exportPending` spinner state and failure `Alert` pattern as today's Markdown export.

### Error handling

- **AI call fails:** the export still proceeds with just the `formatted` (`ask`-note) cards rather
  than failing the whole export — that portion has no network dependency, so a transient AI failure
  on the batched call shouldn't block a reader who mostly wanted their ask-notes as cards. An alert
  informs them some notes couldn't be converted.
- **Nothing to export:** the export action is disabled when there are no saved notes at all, same
  as today. If the AI stage skips everything and there were zero `ask` notes to fall back on, show
  an alert ("No notes could be turned into cards") instead of sharing an empty file.
- **TSV escaping:** `formatAnkiCardLine` strips literal tabs and collapses embedded newlines in
  both fields before writing the file, so no card's content can corrupt the line structure Anki's
  importer expects.

### Out of scope for v1

- **Mind-map concepts as a source** — a natural fast-follow using the same `buildAnkiFile`/TSV
  plumbing, but sequenced after saved notes per the confirmed starting scope.
- **Review/edit screen before export** — AI-generated cards go straight from generation to the
  share sheet, matching the Markdown export's one-tap simplicity. If card quality turns out to be a
  real problem in practice, an editable review list is a natural fast-follow, not a v1 requirement.
- **Real `.apkg` package** — would require building a valid SQLite Anki-collection database from
  scratch (nothing in this codebase parses or writes SQLite today), a meaningfully larger lift for
  a smoother one-tap import versus the plain-text file's two-tap "Import File" flow. Plain text is
  pure string formatting with no new dependency.
- **Cloze-deletion cards** — front/back only. Cloze generation is a harder, more failure-prone
  transform to get right without a review step, and front/back already covers the target use case.

## Testing

- **`src/library/ankiExport.test.ts`** (pure, no App.tsx dependency, same pattern as
  `savedNoteExport.test.ts`): classification per `action`, TSV line escaping (embedded tabs,
  embedded newlines), and the merge/ordering logic that splices AI-returned cards back into their
  original note order.
- **Backend tests** for the new endpoint/handler using a `FakeOpenAI` client (same pattern as
  `backend/tests/test_book_agent.py`): chunking behavior on a note list larger than one chunk, that
  a `noteId` absent from a fake response is correctly treated as skipped, and that the endpoint
  never receives or needs to special-case `ask`-shaped notes.
- No new App.tsx-level interaction tests — consistent with this codebase's established pattern of
  verifying UI flows on-device rather than through `fireEvent`-driven React Native tests.
