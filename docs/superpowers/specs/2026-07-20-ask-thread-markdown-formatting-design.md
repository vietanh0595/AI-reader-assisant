# ChatGPT-like formatting for the "Ask the book" thread

## Problem

Assistant answers in the "Ask the book" conversation thread are hard to read: they
arrive as dense prose with no structure — rarely a bullet list, a numbered
sequence, or emphasized key terms. The user wants the readability of a
ChatGPT-style response (short paragraphs, bullet/numbered lists, bold labels).

This is two coordinated problems, and neither fix works alone:

1. **Nothing renders markdown.** Every assistant answer in the thread is displayed
   as raw `<Text style={styles.answerText}>{turn.text}</Text>`
   (`src/components/ConversationThread.tsx:327`). If the model emitted markdown
   today, the reader would see literal `-`, `**`, and `1.` characters, not
   formatting.
2. **The prompts don't ask for structure.** The agentic answer prompts
   (`SYSTEM_PROMPT` and `HYBRID_SYSTEM_PROMPT` in
   `backend/app/retrieval/agent.py`) give no formatting guidance and cap the body
   at 1200 characters. The model defaults to a single prose block.

Scope is the **"Ask the book" conversation thread only** — the chat surface where
longer, multi-part answers live (including mind-map-originated questions and their
follow-ups). The inline quick-action card (explain / example / rephrase /
summarize) stays deliberately terse and is explicitly out of scope; its prompt
intentionally prefers "one compact paragraph."

## Design

Two halves: the backend asks the model for a constrained markdown subset, and the
frontend renders exactly that subset. Constraining the model to a small grammar is
what keeps the renderer simple and robust.

### Backend: instruct structured markdown, relax the length cap

In `backend/app/retrieval/agent.py`, add a formatting block to **both**
`SYSTEM_PROMPT` and `HYBRID_SYSTEM_PROMPT`. The exact wording is pinned in the
implementation plan; it must instruct the model to emit clean Markdown restricted
to this subset:

- Short paragraphs (1–3 sentences).
- `- ` bullet lists for parallel/enumerated items.
- `1. ` numbered lists for sequences, steps, or ranked items.
- `**bold**` used sparingly, for key terms or labels.
- **No** headings, tables, code blocks, blockquotes, or nested lists.

Length: relax the cap from 1200 to **1800 characters**, wherever it appears:

- The "Keep the body under 1200 characters" line in both `SYSTEM_PROMPT` and
  `HYBRID_SYSTEM_PROMPT` (`agent.py`).
- The same guidance in the non-agentic `BOOK_ANSWER_SYSTEM_PROMPT`
  (`backend/app/retrieval/prompts.py`), for consistency across both answer paths.
- **The hard validator** `body: str = Field(max_length=1200)` in
  `backend/app/retrieval/answerer.py:23` (on `ModelBookAnswer`). This one is
  load-bearing: without bumping it to 1800, a longer structured answer raises a
  Pydantic validation error rather than truncating. Must be raised in lockstep
  with the prompt guidance.
- Verify `BookAgent(max_output_tokens=700)` in `agent.py` is sufficient for ~1800
  characters (~450–500 tokens of body plus tool/JSON overhead). 700 tokens
  (~2800 chars) is comfortably above 1800, so no change is expected — but confirm
  during implementation rather than assume.

The API response schema `body: str` (`schemas.py:45`) has no `max_length`, so it
needs no change.

Inline citations are unaffected: they are a separate structured `sources` array
rendered as chips below the body (`BookSources`), not inline `[n]` markers in the
body text. Markdown rendering of the body cannot collide with them.

### Frontend: a tested pure parser + a themed renderer

**`parseAnswerMarkdown(text: string): AnswerBlock[]`** — a pure, side-effect-free
function (mirroring the codebase's existing tested-helper pattern, e.g.
`src/rag/backgroundNotice.ts`, `src/rag/mindmapTarget.ts`). It returns an ordered
list of blocks over the constrained grammar:

```ts
type AnswerSpan = { text: string; bold?: boolean; code?: boolean };
type AnswerBlock =
  | { type: 'paragraph'; spans: AnswerSpan[] }
  | { type: 'bullet_list'; items: AnswerSpan[][] }   // each item = inline spans
  | { type: 'numbered_list'; items: AnswerSpan[][] };
```

Rules:
- Blank-line-separated chunks become paragraphs unless every line matches a list
  marker.
- Lines beginning `- ` (or `* `) become `bullet_list` items; lines beginning
  `<n>. ` become `numbered_list` items. Consecutive marker lines coalesce into one
  list block.
- Inline `**bold**` and `` `code` `` are parsed into spans within paragraph text
  and within each list item.
- **Graceful degradation is a hard requirement, not a nicety.** An unclosed `**`,
  a stray `*` or `-` in prose, or any construct outside the subset must render as
  literal text — never throw, never drop content. The parser is total over
  arbitrary input.

**`AnswerMarkdown` component** (`src/components/AnswerMarkdown.tsx`) — renders the
parsed blocks with React Native `<Text>`/`<View>`. Presentational only, no touch
handlers (so the parent `Pressable`'s long-press menu keeps working). It matches
the current `answerText` typography (color, font size, line height); bold spans
render with increased font weight, `code` spans in a monospace face; bullet and
numbered items are indented with their marker.

**Wiring** — in `src/components/ConversationThread.tsx`, replace line 327's
`<Text style={styles.answerText}>{turn.text}</Text>` with
`<AnswerMarkdown text={turn.text} />`, left inside the existing answer `Pressable`
(`ConversationThread.tsx:314-333`). Only assistant answer turns change; user turns
(`turn.text` at line ~278) stay plain text.

## Testing

- **Parser** (`parseAnswerMarkdown`): unit tests for plain paragraph, multiple
  paragraphs, `**bold**` spans, bullet list, numbered list, a mixed
  paragraph+list+paragraph answer, and the graceful-degradation cases (unclosed
  `**`, literal `*`/`-` mid-sentence, empty string). This is the bulk of the test
  value since it's pure.
- **Renderer** (`AnswerMarkdown`): React Native render tests — bold text renders
  with the bold style, a bullet list renders each item as a separate row, a
  numbered list renders sequential numbers, and a plain-prose answer renders
  unchanged. Follows the existing `@testing-library/react-native` component-test
  pattern used elsewhere (e.g. `SessionExpiredBanner.test.tsx`).
- **Backend**: update any existing test that asserts the 1200-char cap or the
  prompt text; otherwise this is prompt-only and verified by the full suite as a
  regression pass plus manual on-device confirmation that real answers render with
  visible bullets/bold and no literal markdown characters.
- `App.tsx`/thread integration has no dedicated test file (consistent with the
  rest of the codebase); the wiring change is covered by typecheck + full-suite
  regression + manual verification.

### Manual verification

1. Ask a question in the thread that naturally invites a list (e.g. "what are the
   main types of X?"). Confirm the answer shows real bullets and bold, with no
   literal `-`/`**` characters.
2. Ask something that yields plain prose. Confirm it still reads as normal
   paragraphs, unchanged.
3. Long-press an assistant answer that contains a list. Confirm the "copy / ask
   about this" menu still appears (renderer didn't steal the gesture).
4. Confirm a mind-map-originated question (which now defaults to whole-book scope)
   produces a well-formatted, structured answer.
5. Confirm the inline quick-action card (explain/example/etc.) is unchanged —
   still terse, no new formatting.
