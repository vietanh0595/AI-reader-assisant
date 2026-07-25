# Thread Answer Note Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a note saved out of the "Ask the book" thread a self-contained question-and-answer pair, instead of one whose headline is a bare follow-up like `example` and whose "selected passage" is actually an arbitrary RAG citation.

**Architecture:** Two optional fields (`question`, `citations`) are added to `SavedInsight` so `selectedText` can go back to meaning only reader-selected text. Three pure modules carry the load-bearing logic: `composeNoteQuestion` (resolves a bare follow-up against thread context, no AI call), `flattenAnswerMarkdown` (plain-text previews, since `AnswerMarkdown` renders a `View` per block and cannot be clamped by `numberOfLines`), and `savedNoteExport` (extracted from `App.tsx` so export formatting becomes unit-testable). Saving opens the note editor prefilled so the reader gets the last word on the question.

**Tech Stack:** React Native / TypeScript, Jest + `@testing-library/react-native`. No new dependencies. No backend changes.

## Global Constraints

- **Both new `SavedInsight` fields are optional.** Notes already persisted in `reader-state.json` must keep loading unchanged. No `LIBRARY_SCHEMA_VERSION` bump, no migration — the same additive precedent as `archivedConversations` and `mindMapJob`.
- **`selectedText` holds only text the reader actually selected.** It must never be assigned a citation excerpt. It is `''` for a bare thread follow-up.
- **`eyebrow` means the AI's own short label.** The question lives in `question`. No field's meaning may depend on `action`.
- **List/editor headline is `question || eyebrow`. Export's `Q:` line uses `question` only.** These differ deliberately: an inline Explain note's `eyebrow` is the AI's label ("Consumer spending"), so exporting it as a question would be wrong.
- **`citations` is capped at 3**, matching the backend's own cap in `_build_sources` (`backend/app/retrieval/answerer.py`).
- **A question is "substantive" when, trimmed, it has ≥5 words or ≥30 characters.** Used in one place only (`composeNoteQuestion`).
- **Composition adds no AI call**, no network request, and no latency.
- Existing notes saved with a citation in `selectedText` are **not** repaired — the reader's original selection was never recorded and cannot be recovered. They must keep rendering without crashing.
- The `(See s0-0.)` source-ID leak in answer prose is **out of scope** — separate backend prompt fix.
- Highlight and inline Explain/Example/Rephrase/Summarize notes must not change behaviour beyond gaining Markdown rendering in shared surfaces.
- `App.tsx` is ~7100 lines. Task 3 moves note-export formatting out of it; no other restructuring is in scope.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/components/parseAnswerMarkdown.ts` | Markdown subset parsing (existing) + plain-text flattening | Modify |
| `src/components/parseAnswerMarkdown.test.ts` | Parser + flattener tests | Modify |
| `src/library/composeNoteQuestion.ts` | Resolve a self-contained question from thread context | Create |
| `src/library/composeNoteQuestion.test.ts` | Composition tests | Create |
| `src/library/savedNoteExport.ts` | Turn a display-ready note into clipboard text and Markdown | Create |
| `src/library/savedNoteExport.test.ts` | Export formatting tests | Create |
| `App.tsx` | `SavedInsight` type + validator, `saveChatTurn`, editor, list, export adapter | Modify |

`composeNoteQuestion` lives in `src/library/` beside `conversation.ts` because it operates on `ConversationTurn[]` — that is where conversation-shaped logic already lives, and it keeps the function testable without importing `App.tsx`.

`savedNoteExport` takes a **display-ready** note (labels already resolved) rather than a `SavedInsight`. This deliberately avoids dragging `App.tsx`'s local `DocumentSourceRef`, `InsightAction`, `formatSourceRef`, and `getDocumentSourceLabel` into a new module — `App.tsx` keeps a tiny adapter and the new module has zero imports from it.

---

### Task 1: `flattenAnswerMarkdown` — plain-text previews

The saved-notes list clamps its body preview to 3 lines. `AnswerMarkdown` renders a `View` per block, so `numberOfLines` cannot clamp it. This adds a flattener reusing the existing parser rather than a second regex pass.

**Files:**
- Modify: `src/components/parseAnswerMarkdown.ts`
- Test: `src/components/parseAnswerMarkdown.test.ts`

**Interfaces:**
- Consumes: existing `parseAnswerMarkdown(text: string): AnswerBlock[]` and `AnswerSpan` from this same file.
- Produces: `flattenAnswerMarkdown(text: string): string` — Markdown reduced to one plain-text string with no residual `-`, `*`, `**`, backtick, or `1.` markup. Blocks joined with `' '`, list items with `'; '`. Used by Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/parseAnswerMarkdown.test.ts`:

```ts
import { flattenAnswerMarkdown } from './parseAnswerMarkdown';

describe('flattenAnswerMarkdown', () => {
  test('strips bold markers', () => {
    expect(flattenAnswerMarkdown('This is **important** text')).toBe('This is important text');
  });

  test('strips inline code backticks', () => {
    expect(flattenAnswerMarkdown('Call `useMemo` here')).toBe('Call useMemo here');
  });

  test('flattens a bullet list into semicolon-separated text', () => {
    const input = 'Two examples:\n- **First:** does a thing\n- **Second:** does another';
    expect(flattenAnswerMarkdown(input)).toBe('Two examples: First: does a thing; Second: does another');
  });

  test('flattens a numbered list without its numbers', () => {
    const input = '1. Check your plan\n2. Use funds wisely';
    expect(flattenAnswerMarkdown(input)).toBe('Check your plan; Use funds wisely');
  });

  test('joins multiple paragraphs with a space', () => {
    expect(flattenAnswerMarkdown('First para.\n\nSecond para.')).toBe('First para. Second para.');
  });

  test('returns an empty string for empty input', () => {
    expect(flattenAnswerMarkdown('')).toBe('');
  });

  test('leaves plain text untouched', () => {
    expect(flattenAnswerMarkdown('Just a sentence.')).toBe('Just a sentence.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest parseAnswerMarkdown -t flattenAnswerMarkdown`
Expected: FAIL — `flattenAnswerMarkdown is not a function`.

- [ ] **Step 3: Implement the flattener**

Append to `src/components/parseAnswerMarkdown.ts`:

```ts
// AnswerMarkdown renders one View per block, so numberOfLines can't clamp it. List
// previews need a single Text instead, which means the same parsed blocks reduced to
// plain prose — reusing the parser above rather than a second pass of regexes.
export function flattenAnswerMarkdown(text: string): string {
  return parseAnswerMarkdown(text)
    .map((block) =>
      block.type === 'paragraph'
        ? joinSpans(block.spans)
        : block.items.map(joinSpans).join('; '),
    )
    .filter((part) => part !== '')
    .join(' ');
}

function joinSpans(spans: AnswerSpan[]): string {
  return spans.map((span) => span.text).join('').trim();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest parseAnswerMarkdown`
Expected: PASS — the new block plus every pre-existing parser test.

- [ ] **Step 5: Commit**

```bash
git add src/components/parseAnswerMarkdown.ts src/components/parseAnswerMarkdown.test.ts
git commit -m "feat(notes): flatten answer Markdown to plain text for previews"
```

---

### Task 2: `composeNoteQuestion` — resolve a self-contained question

A bare follow-up (`example`) is meaningless alone. This resolves it against the thread, with no AI call.

**Files:**
- Create: `src/library/composeNoteQuestion.ts`
- Test: `src/library/composeNoteQuestion.test.ts`

**Interfaces:**
- Consumes: `ConversationTurn` from `src/library/conversation.ts` (fields used: `id`, `role`, `text`, `selectedText`).
- Produces:
  - `composeNoteQuestion(conversation: ConversationTurn[], answerTurn: ConversationTurn): string` — used by Task 4.
  - `isSubstantiveQuestion(text: string): boolean` — ≥5 words or ≥30 chars after trimming. Exported for its own tests.

- [ ] **Step 1: Write the failing tests**

Create `src/library/composeNoteQuestion.test.ts`:

```ts
import type { ConversationTurn } from './conversation';
import { composeNoteQuestion, isSubstantiveQuestion } from './composeNoteQuestion';

const turn = (
  over: Partial<ConversationTurn> & Pick<ConversationTurn, 'id' | 'role' | 'text'>,
): ConversationTurn => ({ createdAt: 'now', ...over });

describe('isSubstantiveQuestion', () => {
  test('a one-word follow-up is not substantive', () => {
    expect(isSubstantiveQuestion('example')).toBe(false);
  });

  test('a five-word question is substantive', () => {
    expect(isSubstantiveQuestion('what does this term actually mean')).toBe(true);
  });

  test('a long four-word question is substantive on length', () => {
    expect(isSubstantiveQuestion('compare diversification versus concentration strategies')).toBe(true);
  });

  test('whitespace-only is not substantive', () => {
    expect(isSubstantiveQuestion('   ')).toBe(false);
  });
});

describe('composeNoteQuestion', () => {
  test('composes a bare follow-up from a quoted subject two turns back', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'Tell me more about "529 Plan", as discussed in this book and beyond.' }),
      turn({ id: 'a1', role: 'assistant', text: 'A 529 plan is...' }),
      turn({ id: 'u2', role: 'user', text: 'example' }),
      turn({ id: 'a2', role: 'assistant', text: 'Here are two examples...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[3])).toBe('529 Plan — example');
  });

  test('treats curly quotes the same as straight quotes', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'Tell me more about “529 Plan”, as discussed in this book.' }),
      turn({ id: 'a1', role: 'assistant', text: 'A 529 plan is...' }),
      turn({ id: 'u2', role: 'user', text: 'example' }),
      turn({ id: 'a2', role: 'assistant', text: 'Here are two examples...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[3])).toBe('529 Plan — example');
  });

  test('passes a substantive question through verbatim', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'How do prepaid tuition plans differ from savings plans?' }),
      turn({ id: 'a1', role: 'assistant', text: 'They differ in...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[1])).toBe(
      'How do prepaid tuition plans differ from savings plans?',
    );
  });

  test('passes a short question through verbatim when it had a selection', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'Explain this passage', selectedText: 'The most basic premise' }),
      turn({ id: 'a1', role: 'assistant', text: 'This means...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[1])).toBe('Explain this passage');
  });

  test('trims an unquoted subject to 60 characters with an ellipsis', () => {
    const long = 'Walk me through every single detail of how compound interest works over decades';
    const conversation = [
      turn({ id: 'u1', role: 'user', text: long }),
      turn({ id: 'a1', role: 'assistant', text: 'Compound interest...' }),
      turn({ id: 'u2', role: 'user', text: 'more' }),
      turn({ id: 'a2', role: 'assistant', text: 'Additionally...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[3])).toBe(
      'Walk me through every single detail of how compound interest w… — more',
    );
  });

  test('returns the follow-up alone when there is no earlier substantive turn', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'example' }),
      turn({ id: 'a1', role: 'assistant', text: 'Here is one...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[1])).toBe('example');
  });

  test('returns an empty string when the answer has no preceding user turn', () => {
    const conversation = [turn({ id: 'a1', role: 'assistant', text: 'Orphan answer' })];
    expect(composeNoteQuestion(conversation, conversation[0])).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest composeNoteQuestion`
Expected: FAIL — cannot find module `./composeNoteQuestion`.

- [ ] **Step 3: Implement the composer**

Create `src/library/composeNoteQuestion.ts`:

```ts
import type { ConversationTurn } from './conversation';

const MIN_SUBSTANTIVE_WORDS = 5;
const MIN_SUBSTANTIVE_CHARS = 30;
const MAX_SUBJECT_CHARS = 60;
// Templated questions are authored with straight quotes, but text can arrive curly.
const QUOTED_SUBJECT = /["“]([^"”]+)["”]/;

// A bare follow-up ("example", "why", "more") is meaningless once lifted out of the
// thread it was asked in. Resolve it against the conversation so a saved note stands
// on its own — no AI call, so this costs nothing and can't fail at save time.
export function composeNoteQuestion(
  conversation: ConversationTurn[],
  answerTurn: ConversationTurn,
): string {
  const askedIndex = conversation.findIndex((candidate) => candidate.id === answerTurn.id) - 1;
  const askedTurn = askedIndex >= 0 ? conversation[askedIndex] : null;

  if (!askedTurn || askedTurn.role !== 'user') {
    return '';
  }

  const question = askedTurn.text.trim();

  // A selection is its own context, so a short question like "Explain this passage"
  // needs no composing — the passage travels with the note.
  if (askedTurn.selectedText || isSubstantiveQuestion(question)) {
    return question;
  }

  const subject = findSubject(conversation, askedIndex);

  return subject ? `${subject} — ${question}` : question;
}

export function isSubstantiveQuestion(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed === '') {
    return false;
  }

  return (
    trimmed.split(/\s+/).length >= MIN_SUBSTANTIVE_WORDS || trimmed.length >= MIN_SUBSTANTIVE_CHARS
  );
}

function findSubject(conversation: ConversationTurn[], askedIndex: number): string {
  for (let index = askedIndex - 1; index >= 0; index -= 1) {
    const candidate = conversation[index];

    if (candidate.role !== 'user' || !isSubstantiveQuestion(candidate.text)) {
      continue;
    }

    const quoted = candidate.text.match(QUOTED_SUBJECT);

    if (quoted) {
      return quoted[1].trim();
    }

    const trimmed = candidate.text.trim();

    return trimmed.length > MAX_SUBJECT_CHARS
      ? `${trimmed.slice(0, MAX_SUBJECT_CHARS - 1).trimEnd()}…`
      : trimmed;
  }

  return '';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest composeNoteQuestion`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/library/composeNoteQuestion.ts src/library/composeNoteQuestion.test.ts
git commit -m "feat(notes): compose a self-contained question from thread context"
```

---

### Task 3: Extract note-export formatting out of `App.tsx`

Export correctness has no test coverage today because both formatters are private functions inside a 7100-line file. This is a **pure refactor with no behaviour change** — extract them, characterise current behaviour with tests, then Task 5 extends them safely.

**Files:**
- Create: `src/library/savedNoteExport.ts`
- Test: `src/library/savedNoteExport.test.ts`
- Modify: `App.tsx` — delete `formatSavedInsightForExport`, `formatSavedInsightAsMarkdown`, `formatSavedNoteDate`; add an adapter

**Interfaces:**
- Consumes: nothing from `App.tsx` — deliberately.
- Produces:
  - `type ExportableNote = { actionLabel: string; body: string; createdAt: string; question: string; selectedText: string; sourceLabel?: string; userNote?: string }`
  - `formatNoteAsText(note: ExportableNote, index: number): string`
  - `formatNoteAsMarkdown(note: ExportableNote, index: number): string`
  - `formatNoteDate(value: string): string`

  Task 5 extends `ExportableNote` with `citations`.

- [ ] **Step 1: Write the characterisation tests**

Create `src/library/savedNoteExport.test.ts`. These assert the behaviour that exists **today**, so the refactor is provably safe:

```ts
import { formatNoteAsMarkdown, formatNoteAsText, formatNoteDate, type ExportableNote } from './savedNoteExport';

const note = (over: Partial<ExportableNote> = {}): ExportableNote => ({
  actionLabel: 'Ask',
  body: 'Consumer purchases drive economic activity.',
  createdAt: '2026-07-25T10:00:00.000Z',
  question: '',
  selectedText: '',
  ...over,
});

describe('formatNoteDate', () => {
  test('returns the raw value when it is not a date', () => {
    expect(formatNoteDate('not-a-date')).toBe('not-a-date');
  });

  test('formats a valid ISO date', () => {
    expect(formatNoteDate('2026-07-25T10:00:00.000Z')).toMatch(/2026/);
  });
});

describe('formatNoteAsText', () => {
  test('numbers the note and labels its action', () => {
    expect(formatNoteAsText(note(), 0)).toContain('1. Ask - ');
  });

  test('includes the source label when present', () => {
    expect(formatNoteAsText(note({ sourceLabel: 'PDF 175' }), 0)).toContain('Source: PDF 175');
  });

  test('includes the question when present', () => {
    expect(formatNoteAsText(note({ question: '529 Plan — example' }), 0)).toContain('Q: 529 Plan — example');
  });

  test('omits the question line when empty', () => {
    expect(formatNoteAsText(note(), 0)).not.toContain('Q:');
  });

  test('omits the selected line when there is no selection', () => {
    expect(formatNoteAsText(note(), 0)).not.toContain('Selected:');
  });

  test('omits the AI line for a note with no body', () => {
    expect(formatNoteAsText(note({ body: '' }), 0)).not.toContain('AI:');
  });

  test('includes the user note when present', () => {
    expect(formatNoteAsText(note({ userNote: 'revisit this' }), 0)).toContain('Note: revisit this');
  });
});

describe('formatNoteAsMarkdown', () => {
  test('uses a level-three heading with the action label', () => {
    expect(formatNoteAsMarkdown(note(), 0)).toMatch(/^### 1\. Ask — /);
  });

  test('italicises the source label', () => {
    expect(formatNoteAsMarkdown(note({ sourceLabel: 'PDF 175' }), 0)).toContain('*PDF 175*');
  });

  test('bolds the question label', () => {
    expect(formatNoteAsMarkdown(note({ question: '529 Plan — example' }), 0)).toContain(
      '**Q:** 529 Plan — example',
    );
  });

  test('blockquotes the selection', () => {
    expect(formatNoteAsMarkdown(note({ selectedText: 'The most basic premise' }), 0)).toContain(
      '> The most basic premise',
    );
  });

  test('emits no blockquote when there is no selection', () => {
    expect(formatNoteAsMarkdown(note(), 0)).not.toContain('>');
  });

  test('emits no AI section for a highlight with no body', () => {
    expect(formatNoteAsMarkdown(note({ actionLabel: 'Highlight', body: '' }), 0)).not.toContain('**AI:**');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest savedNoteExport`
Expected: FAIL — cannot find module `./savedNoteExport`.

- [ ] **Step 3: Create the module**

Create `src/library/savedNoteExport.ts`. This is the current `App.tsx` logic with labels taken as inputs so the module needs nothing from `App.tsx`:

```ts
// A saved note reduced to display-ready strings. Taking labels as inputs keeps this
// module free of App.tsx's local DocumentSourceRef/InsightAction types and its
// formatSourceRef helper, so export formatting is testable in isolation.
export type ExportableNote = {
  actionLabel: string;
  body: string;
  createdAt: string;
  question: string;
  selectedText: string;
  sourceLabel?: string;
  userNote?: string;
};

export function formatNoteAsText(note: ExportableNote, index: number): string {
  const lines = [`${index + 1}. ${note.actionLabel} - ${formatNoteDate(note.createdAt)}`];

  if (note.sourceLabel) {
    lines.push(`Source: ${note.sourceLabel}`);
  }

  if (note.question) {
    lines.push(`Q: ${note.question}`);
  }

  if (note.selectedText) {
    lines.push(`Selected: ${note.selectedText}`);
  }

  if (note.body) {
    lines.push(`AI: ${note.body}`);
  }

  if (note.userNote) {
    lines.push(`Note: ${note.userNote}`);
  }

  return lines.join('\n');
}

export function formatNoteAsMarkdown(note: ExportableNote, index: number): string {
  const lines = [`### ${index + 1}. ${note.actionLabel} — ${formatNoteDate(note.createdAt)}`];

  if (note.sourceLabel) {
    lines.push(`*${note.sourceLabel}*`);
  }

  if (note.question) {
    lines.push(`**Q:** ${note.question}`);
  }

  if (note.selectedText) {
    lines.push(`> ${note.selectedText.replace(/\n/g, '\n> ')}`);
  }

  if (note.body) {
    lines.push(`**AI:** ${note.body}`);
  }

  if (note.userNote) {
    lines.push(`**Note:** ${note.userNote}`);
  }

  return lines.join('\n\n');
}

export function formatNoteDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest savedNoteExport`
Expected: PASS — 15 tests.

- [ ] **Step 5: Replace the `App.tsx` originals with an adapter**

Delete `formatSavedInsightForExport`, `formatSavedInsightAsMarkdown`, and `formatSavedNoteDate` from `App.tsx`. Add the import:

```ts
import {
  formatNoteAsMarkdown,
  formatNoteAsText,
  type ExportableNote,
} from './src/library/savedNoteExport';
```

Add the adapter where the deleted formatters were. `question` reads `eyebrow` for `ask` notes only, exactly preserving today's behaviour — Task 5 switches it to the real `question` field:

```ts
function toExportableNote(note: SavedInsight): ExportableNote {
  return {
    actionLabel: getInsightActionLabel(note.action),
    body: normalizeSelectionText(note.body),
    createdAt: note.createdAt,
    question: note.action === 'ask' ? normalizeSelectionText(note.eyebrow) : '',
    selectedText: normalizeSelectionText(note.selectedText),
    sourceLabel: formatSourceRef(note.sourceRef),
    userNote: normalizeSelectionText(note.userNote ?? '') || undefined,
  };
}
```

Update the two call sites to map through the adapter:

```ts
  const body = sortedNotes
    .map((note, index) => formatNoteAsText(toExportableNote(note), index))
    .join('\n\n');
```

```ts
  const body = sortedNotes
    .map((note, index) => formatNoteAsMarkdown(toExportableNote(note), index))
    .join('\n\n---\n\n');
```

`formatSavedNoteDate` had only two call sites and both were inside the two deleted formatters, so nothing else in `App.tsx` needs updating — the Step 6 `grep` confirms this. The imported `formatNoteDate` is used only by the new module; import it in `App.tsx` only if a later task needs it, otherwise omit it from the import list to avoid an unused-import error.

- [ ] **Step 6: Verify the refactor changed nothing**

Run: `npx tsc --noEmit && npx jest && grep -c "formatSavedNoteDate\|formatSavedInsightForExport\|formatSavedInsightAsMarkdown" App.tsx`
Expected: typecheck clean, all suites PASS, and the `grep -c` prints `0`.

- [ ] **Step 7: Commit**

```bash
git add App.tsx src/library/savedNoteExport.ts src/library/savedNoteExport.test.ts
git commit -m "refactor(notes): extract note export formatting out of App.tsx"
```

---

### Task 4: `SavedInsight` gains `question` and `citations`

The type, its validator, and the rewritten `saveChatTurn` ship together — the fields are meaningless without a writer, and a writer without validation would silently drop them on the next app launch.

> **Expected intermediate state:** this task writes `question` and sets `eyebrow: ''` for thread notes, but the editor and list don't read `question` until Task 6. So between these two tasks a newly saved thread note shows no title in the editor. That is deliberate sequencing, not a regression — do not "fix" it here. Task 4's deliverable is verified by typecheck and the full suite; the UI catches up in Task 6.

**Files:**
- Modify: `App.tsx:209-222` (`SavedInsight` type)
- Modify: `App.tsx:1735-1751` (`isSavedInsight`)
- Modify: `App.tsx:3316-3350` (`saveChatTurn`)

**Interfaces:**
- Consumes: `composeNoteQuestion` (Task 2); existing `findPrecedingUserTurn`, `isDocumentSourceRef`, `isRecord`, `isFiniteNumber`, `getParagraphSourceRef`; `BookSource` from `src/rag/bookAskTypes.ts`.
- Produces:
  - `type SavedCitation = Omit<BookSource, 'id'>`
  - `SavedInsight.question?: string`, `SavedInsight.citations?: SavedCitation[]`
  - `isSavedCitation(value: unknown): value is SavedCitation`
  - `getSavedNoteHeadline(note: SavedInsight): string` → `question || eyebrow`. Used by Task 6. **Not** used by export (see Global Constraints).

- [ ] **Step 1: Add the import, citation type, and the two fields**

Add to `App.tsx` imports:

```ts
import { composeNoteQuestion } from './src/library/composeNoteQuestion';
```

Replace the `SavedInsight` type at `App.tsx:209`:

```ts
// BookSource minus its `id`, which is a per-request identifier (s0-0) that means
// nothing once the request is over and would collide across saved notes.
type SavedCitation = Omit<BookSource, 'id'>;

type SavedInsight = {
  action: InsightAction;
  body: string;
  bookTitle: string;
  // Every source the answer drew on, not one promoted to look like a passage the
  // reader chose. Capped at 3, matching the backend.
  citations?: SavedCitation[];
  createdAt: string;
  // The AI's own short label. Not the question — see `question`.
  eyebrow: string;
  id: string;
  paragraphId: string;
  // The self-contained question this note answers. Set for thread-saved notes.
  question?: string;
  // Only ever text the reader actually selected. Never a citation excerpt.
  selectedText: string;
  selectionKind: SelectionKind;
  sourceRef?: DocumentSourceRef;
  updatedAt?: string;
  userNote?: string;
};
```

- [ ] **Step 2: Extend the validator and add the headline helper**

Replace `isSavedInsight` at `App.tsx:1735`:

```ts
function isSavedInsight(value: unknown): value is SavedInsight {
  return (
    isRecord(value) &&
    isInsightAction(value.action) &&
    typeof value.body === 'string' &&
    typeof value.bookTitle === 'string' &&
    (value.citations === undefined ||
      (Array.isArray(value.citations) && value.citations.every(isSavedCitation))) &&
    typeof value.createdAt === 'string' &&
    typeof value.eyebrow === 'string' &&
    typeof value.id === 'string' &&
    typeof value.paragraphId === 'string' &&
    (value.question === undefined || typeof value.question === 'string') &&
    typeof value.selectedText === 'string' &&
    (value.selectionKind === 'word' || value.selectionKind === 'phrase' || value.selectionKind === 'paragraph') &&
    (value.sourceRef === undefined || isDocumentSourceRef(value.sourceRef)) &&
    (value.updatedAt === undefined || typeof value.updatedAt === 'string') &&
    (value.userNote === undefined || typeof value.userNote === 'string')
  );
}

function isSavedCitation(value: unknown): value is SavedCitation {
  return (
    isRecord(value) &&
    typeof value.excerpt === 'string' &&
    typeof value.paragraphId === 'string' &&
    isDocumentSourceRef(value.sourceRef) &&
    (value.chapterTitle === undefined || typeof value.chapterTitle === 'string') &&
    (value.pageIndex === undefined || isFiniteNumber(value.pageIndex)) &&
    (value.pageLabel === undefined || typeof value.pageLabel === 'string')
  );
}

// Thread notes are titled by their question; highlights and inline insights keep the
// AI's eyebrow. One place, so the list and editor can't disagree. Export deliberately
// does NOT use this — an eyebrow is a label, not a question.
function getSavedNoteHeadline(note: SavedInsight): string {
  return note.question || note.eyebrow;
}
```

- [ ] **Step 3: Rewrite `saveChatTurn`**

Replace `saveChatTurn` at `App.tsx:3316`:

```ts
  function saveChatTurn(turn: ConversationTurn) {
    const insightId = createChatInsightId(turn);

    if (savedInsights.some((note) => note.id === insightId)) {
      return;
    }

    const askedTurn = findPrecedingUserTurn(activeLibraryItem.conversation, turn);
    const citations: SavedCitation[] = (turn.sources ?? [])
      .slice(0, 3)
      .map(({ id: _id, ...citation }) => citation);
    // Only a passage the reader actually selected earns this field. A citation is what
    // the retriever looked at, not what the reader pointed to, so it stays in
    // `citations` where it can't masquerade as a selection.
    const selectedText = askedTurn?.selectedText ?? '';
    const paragraphId =
      askedTurn?.contextParagraphId ?? citations[0]?.paragraphId ?? readingLocation?.paragraphId ?? '';
    const savedAt = new Date().toISOString();
    const note: SavedInsight = {
      action: 'ask',
      body: turn.text,
      bookTitle: currentBook.title,
      citations: citations.length > 0 ? citations : undefined,
      createdAt: savedAt,
      eyebrow: '',
      id: insightId,
      paragraphId,
      question: composeNoteQuestion(activeLibraryItem.conversation, turn),
      selectedText,
      selectionKind: 'paragraph',
      sourceRef: citations[0]?.sourceRef ?? getParagraphSourceRef(paragraphId, currentBook),
    };

    updateActiveLibraryItem((item) => ({
      ...item,
      lastOpenedAt: savedAt,
      savedInsights: [...item.savedInsights, note],
    }));
    // Open the editor on the new note so the reader can correct a composed question and
    // add their own thought while it's fresh. `editingNote` renders last in the sheet
    // stack, so it lands above the open thread; closing it returns to the conversation.
    startEditingSavedInsight(note);
  }
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: typecheck clean, every suite PASS.

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "feat(notes): give thread notes their own question and citation fields"
```

---

### Task 5: Export the question and citations

**Files:**
- Modify: `src/library/savedNoteExport.ts`
- Modify: `src/library/savedNoteExport.test.ts`
- Modify: `App.tsx` — `toExportableNote`

**Interfaces:**
- Consumes: `ExportableNote`, `formatNoteAsText`, `formatNoteAsMarkdown` (Task 3); `SavedCitation` (Task 4).
- Produces:
  - `ExportableNote.citations?: ExportableCitation[]`
  - `type ExportableCitation = { chapterTitle?: string; excerpt: string; pageIndex?: number; pageLabel?: string }`
  - `formatCitationLabel(citation: ExportableCitation): string`

- [ ] **Step 1: Write the failing tests**

In `src/library/savedNoteExport.test.ts`, add `formatCitationLabel` to the **existing** import from
`./savedNoteExport` (do not add a second import statement from the same module), so the first line
becomes:

```ts
import {
  formatCitationLabel,
  formatNoteAsMarkdown,
  formatNoteAsText,
  formatNoteDate,
  type ExportableNote,
} from './savedNoteExport';
```

Then append:

```ts
describe('formatCitationLabel', () => {
  test('joins chapter and page label', () => {
    expect(formatCitationLabel({ chapterTitle: 'Chapter 7', excerpt: 'x', pageLabel: '175' })).toBe(
      'Chapter 7 · 175',
    );
  });

  test('derives a page number from pageIndex when there is no label', () => {
    expect(formatCitationLabel({ chapterTitle: 'Chapter 7', excerpt: 'x', pageIndex: 174 })).toBe(
      'Chapter 7 · Page 175',
    );
  });

  test('falls back to a trimmed excerpt when there is no chapter or page', () => {
    expect(formatCitationLabel({ excerpt: 'Only for College' })).toBe('Only for College');
  });
});

describe('citations in exports', () => {
  const cited = note({
    citations: [
      { chapterTitle: 'Chapter 7', excerpt: 'Only for College', pageLabel: '175' },
      { chapterTitle: 'Chapter 7', excerpt: 'All about 529 Plans', pageLabel: '174' },
    ],
  });

  test('text export lists each citation', () => {
    const output = formatNoteAsText(cited, 0);
    expect(output).toContain('Cited: Chapter 7 · 175');
    expect(output).toContain('Cited: Chapter 7 · 174');
  });

  test('markdown export lists citations under a bold label', () => {
    const output = formatNoteAsMarkdown(cited, 0);
    expect(output).toContain('**Cited:**');
    expect(output).toContain('- Chapter 7 · 175');
  });

  test('neither export emits a citation section when there are none', () => {
    expect(formatNoteAsText(note(), 0)).not.toContain('Cited');
    expect(formatNoteAsMarkdown(note(), 0)).not.toContain('Cited');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest savedNoteExport`
Expected: FAIL — `formatCitationLabel is not a function`, and the citation assertions fail.

- [ ] **Step 3: Extend the module**

In `src/library/savedNoteExport.ts`, add the citation type to `ExportableNote` and the two emitters:

```ts
export type ExportableCitation = {
  chapterTitle?: string;
  excerpt: string;
  pageIndex?: number;
  pageLabel?: string;
};
```

Add `citations?: ExportableCitation[];` to `ExportableNote`.

In `formatNoteAsText`, after the `userNote` block:

```ts
  for (const citation of note.citations ?? []) {
    lines.push(`Cited: ${formatCitationLabel(citation)}`);
  }
```

In `formatNoteAsMarkdown`, after the `userNote` block:

```ts
  const citations = note.citations ?? [];

  if (citations.length > 0) {
    lines.push(
      ['**Cited:**', ...citations.map((citation) => `- ${formatCitationLabel(citation)}`)].join('\n'),
    );
  }
```

And the label helper:

```ts
export function formatCitationLabel(citation: ExportableCitation): string {
  const page =
    citation.pageLabel ?? (citation.pageIndex !== undefined ? `Page ${citation.pageIndex + 1}` : '');
  const parts = [citation.chapterTitle, page].filter((part) => part);

  return parts.length > 0 ? parts.join(' · ') : citation.excerpt.slice(0, 80);
}
```

- [ ] **Step 4: Switch the adapter to the real question and pass citations**

In `App.tsx`, update `toExportableNote`:

```ts
function toExportableNote(note: SavedInsight): ExportableNote {
  return {
    actionLabel: getInsightActionLabel(note.action),
    body: normalizeSelectionText(note.body),
    // `question`, not the headline: an eyebrow is the AI's label, not something the
    // reader asked, so exporting it as "Q:" would misrepresent the note.
    citations: note.citations?.map((citation) => ({
      chapterTitle: citation.chapterTitle,
      excerpt: normalizeSelectionText(citation.excerpt),
      pageIndex: citation.pageIndex,
      pageLabel: citation.pageLabel,
    })),
    createdAt: note.createdAt,
    question: normalizeSelectionText(note.question ?? ''),
    selectedText: normalizeSelectionText(note.selectedText),
    sourceLabel: formatSourceRef(note.sourceRef),
    userNote: normalizeSelectionText(note.userNote ?? '') || undefined,
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx jest savedNoteExport && npx tsc --noEmit && npx jest`
Expected: the export suite PASSes with its new tests; typecheck clean; every suite PASS.

- [ ] **Step 6: Commit**

```bash
git add App.tsx src/library/savedNoteExport.ts src/library/savedNoteExport.test.ts
git commit -m "feat(notes): export the question and citations of thread notes"
```

---

### Task 6: Render notes as Q&A with real Markdown

The editor becomes the full-read surface: editable question, genuine selection only, formatted answer, tappable citations. The list titles from the headline and previews flattened text.

**Files:**
- Modify: `App.tsx` — new `editingNoteQuestion` state, `startEditingSavedInsight`, `cancelEditingSavedInsight`, `saveEditedSavedInsight`, `SavedNoteEditorSheet` + its call site, `SavedNotesSheet` list item, styles

**Interfaces:**
- Consumes: `getSavedNoteHeadline` (Task 4), `flattenAnswerMarkdown` (Task 1), existing `AnswerMarkdown`, `BookSources`, `useKeyboardOverlap`, `navigateToSource`.
- Produces: no new exported interfaces.

- [ ] **Step 1: Add imports and question state**

Add to `App.tsx` imports:

```ts
import { AnswerMarkdown } from './src/components/AnswerMarkdown';
import { flattenAnswerMarkdown } from './src/components/parseAnswerMarkdown';
```

Add beside `editingNoteText` (`App.tsx:2494`):

```ts
  const [editingNoteQuestion, setEditingNoteQuestion] = useState('');
```

- [ ] **Step 2: Widen the three edit handlers**

Replace `startEditingSavedInsight`, `cancelEditingSavedInsight`, and `saveEditedSavedInsight` (`App.tsx:3662-3695`):

```ts
  function startEditingSavedInsight(note: SavedInsight) {
    setEditingNote(note);
    setEditingNoteText(note.userNote ?? '');
    setEditingNoteQuestion(note.question ?? '');
  }

  function cancelEditingSavedInsight() {
    setEditingNote(null);
    setEditingNoteText('');
    setEditingNoteQuestion('');
  }

  function saveEditedSavedInsight() {
    if (!editingNote) {
      return;
    }

    const trimmedNote = editingNoteText.trim();
    const trimmedQuestion = editingNoteQuestion.trim();
    const updatedAt = new Date().toISOString();

    updateActiveLibraryItem((item) => ({
      ...item,
      lastOpenedAt: updatedAt,
      savedInsights: item.savedInsights.map((savedInsight) =>
        savedInsight.id === editingNote.id
          ? {
              ...savedInsight,
              // Only notes that already carry a question can gain one, so editing a
              // highlight can't silently invent a headline for it.
              question:
                editingNote.question === undefined ? savedInsight.question : trimmedQuestion || undefined,
              updatedAt,
              userNote: trimmedNote || undefined,
            }
          : savedInsight,
      ),
    }));
    setEditingNote(null);
    setEditingNoteText('');
    setEditingNoteQuestion('');
  }
```

- [ ] **Step 3: Rewrite the editor sheet**

Replace `SavedNoteEditorSheet`'s signature and its context block:

```tsx
function SavedNoteEditorSheet({
  note,
  noteQuestion,
  noteText,
  onChangeNoteQuestion,
  onChangeNoteText,
  onClose,
  onNavigateSource,
  onSave,
}: {
  note: SavedInsight;
  noteQuestion: string;
  noteText: string;
  onChangeNoteQuestion: (value: string) => void;
  onChangeNoteText: (value: string) => void;
  onClose: () => void;
  onNavigateSource: (paragraphId: string, excerpt?: string) => void;
  onSave: () => void;
}) {
  const canSave =
    noteText.trim() !== (note.userNote ?? '').trim() ||
    noteQuestion.trim() !== (note.question ?? '').trim();
  const sourceLabel = formatSourceRef(note.sourceRef);
  const keyboardOverlap = useKeyboardOverlap();
  const citationSources = (note.citations ?? []).map((citation, index) => ({
    ...citation,
    id: `${note.id}-citation-${index}`,
  }));
```

Replace the context `ScrollView` block (currently rendering `noteEditorQuestion`, `noteEditorSelection`, `noteEditorSource`) with:

```tsx
        {note.question !== undefined ? (
          <TextInput
            multiline
            onChangeText={onChangeNoteQuestion}
            placeholder="What was the question?"
            placeholderTextColor="#8c8a84"
            style={styles.noteEditorQuestionInput}
            value={noteQuestion}
          />
        ) : null}
        {note.selectedText || note.body || citationSources.length > 0 ? (
          <ScrollView
            style={[styles.noteEditorContext, keyboardOverlap > 0 && styles.noteEditorContextCompact]}
            contentContainerStyle={styles.noteEditorContextContent}
            showsVerticalScrollIndicator
          >
            {note.selectedText ? (
              <Text style={styles.noteEditorSelection}>{note.selectedText}</Text>
            ) : null}
            {note.body ? (
              <View style={styles.noteEditorAnswer}>
                <AnswerMarkdown text={note.body} />
              </View>
            ) : null}
            {citationSources.length > 0 ? (
              <View style={styles.noteEditorCitations}>
                <BookSources sources={citationSources} onNavigate={onNavigateSource} />
              </View>
            ) : null}
          </ScrollView>
        ) : null}
```

- [ ] **Step 4: Swap the styles**

Delete `noteEditorQuestion` and `noteEditorSource`. Add:

```ts
  noteEditorQuestionInput: {
    borderColor: '#d6d3cc',
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 19,
    marginBottom: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  noteEditorAnswer: {
    backgroundColor: colors.warmNote,
    borderColor: colors.warmNoteBorder,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  noteEditorCitations: {
    marginTop: 10,
  },
```

- [ ] **Step 5: Update the editor call site**

Replace the `SavedNoteEditorSheet` usage (`App.tsx:4358`):

```tsx
              {editingNote ? (
                <SavedNoteEditorSheet
                  note={editingNote}
                  noteQuestion={editingNoteQuestion}
                  noteText={editingNoteText}
                  onChangeNoteQuestion={setEditingNoteQuestion}
                  onChangeNoteText={setEditingNoteText}
                  onClose={cancelEditingSavedInsight}
                  onNavigateSource={navigateToSource}
                  onSave={saveEditedSavedInsight}
                />
              ) : null}
```

- [ ] **Step 6: Update the list item**

In `SavedNotesSheet`, use the headline (`App.tsx:5368`):

```tsx
                    <Text numberOfLines={1} style={styles.savedNoteEyebrow}>
                      {getSavedNoteHeadline(note)}
                    </Text>
```

and flatten the body preview:

```tsx
                  {note.body ? (
                    <Text numberOfLines={3} style={styles.savedNoteBody}>
                      {flattenAnswerMarkdown(note.body)}
                    </Text>
                  ) : null}
```

- [ ] **Step 7: Typecheck, test, and confirm no stale styles**

Run: `npx tsc --noEmit && npx jest && grep -c "noteEditorQuestion:\|noteEditorSource:" App.tsx`
Expected: typecheck clean, all suites PASS, `grep -c` prints `0`.

- [ ] **Step 8: Commit**

```bash
git add App.tsx
git commit -m "feat(notes): render saved notes as Q&A with formatted answers and citations"
```

---

### Task 7: On-device verification

The save flow, sheet stacking, and keyboard behaviour have no automated coverage in this codebase — the long-press menu could not be driven by `fireEvent` in this RN version. The validator's tolerance of pre-existing notes is also checked here rather than by a unit test, because `isSavedInsight` depends on `isDocumentSourceRef`/`isRecord`/`isFiniteNumber`, which serve many other `App.tsx` validators and are not worth extracting for this change.

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Verify a bare follow-up composes and saves cleanly**

Open a book with Whole-Book AI ready. In the thread, ask a substantive question about a topic in the book, then send a bare follow-up: `example`. Long-press the follow-up's answer → **Save**.

Confirm all of:
- The editor opens **above** the thread.
- The question field is prefilled with a composed question (`<subject> — example`), not bare `example`.
- **No citation appears as the quoted passage.** Citations appear only as chips under the answer.
- The answer is formatted — bullets and bold render, with no visible `**` or `- `.

- [ ] **Step 2: Verify editing and the list headline**

Correct the question, add your own note, tap **Save**. Open Saved notes: the row is titled with your corrected question, and its preview is plain prose with no `**` markup.

- [ ] **Step 3: Verify stacking and navigation**

Reopen the note via the pencil. Tap a citation chip — it jumps to that passage. Reopen the editor and close with **Cancel** — the thread is still open underneath.

- [ ] **Step 4: Verify the selection-anchored path**

In the reader, select a passage → **Explain**. Open the thread, long-press that answer → **Save**. The note shows the **selected passage** as the quoted serif text, because this path has a genuine selection.

- [ ] **Step 5: Verify pre-existing notes still load**

Confirm notes saved before this change (including any with a citation stuck in `selectedText`) still appear in the list and open in the editor without crashing. This is the check that `isSavedInsight` stayed backward-compatible — a rejected note would silently vanish from the list.

- [ ] **Step 6: Verify export**

Tap **Export** and open the `.md`: confirm a `**Q:**` line on thread notes, **no** `**Q:**` on inline Explain notes, a `>` blockquote only where a real selection exists, a `**Cited:**` list, and intact Markdown in the answer body.

- [ ] **Step 7: Update the release-plan checklist**

Add a line to "Feature improvements / additions" in `/Users/vietanh0495/Documents/Obsidian Vault/projects/Book Reading App - Release Plan.md` recording that thread-saved notes are now self-contained Q&A, and note that the `(See s0-0.)` source-ID leak remains open as a separate backend prompt bug.
