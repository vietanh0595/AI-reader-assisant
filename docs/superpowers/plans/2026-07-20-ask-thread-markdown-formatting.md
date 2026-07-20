# Ask Thread Markdown Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render ChatGPT-like formatting (bold, bullet lists, numbered lists) in the "Ask the book" conversation thread, driven by matching backend prompt guidance.

**Architecture:** Backend prompts instruct the model to emit a small, constrained Markdown subset and the length cap is raised to accommodate it. A pure frontend parser (`parseAnswerMarkdown`) turns that subset into typed blocks, and a presentational component (`AnswerMarkdown`) renders those blocks with React Native `Text`/`View`, replacing the raw `<Text>{turn.text}</Text>` currently used for assistant answers in `ConversationThread.tsx`.

**Tech Stack:** Python/FastAPI/Pydantic (backend), React Native/TypeScript, Jest + `@testing-library/react-native` (frontend). No new dependencies.

## Global Constraints

- Scope is the "Ask the book" conversation thread only. The inline quick-action card (explain/example/rephrase/summarize) is explicitly out of scope and must not change.
- The supported Markdown subset is exactly: short paragraphs, `- `/`* ` bullet lists, `<n>. ` numbered lists, and `**bold**` (plus optional inline `` `code` ``). No headings, tables, code blocks, blockquotes, or nested lists — the prompts must not invite these, and the parser is not required to handle them specially.
- The parser must be total: it must never throw, and any input outside the supported subset (unclosed `**`, a stray `*`/`-` mid-sentence, empty string) must degrade to literal text rather than error or drop content.
- The body length cap moves from 1200 to 1800 characters everywhere it's enforced (prompt guidance text and the Pydantic validator) — these must move together, since a mismatch would let the model write longer answers that then fail validation.
- Citations remain a separate structured `sources` array rendered by `BookSources`, never inline `[n]` markers in the body — this diff must not change citation handling.

---

### Task 1: Backend — structured-Markdown prompt guidance and raised length cap

**Files:**
- Modify: `backend/app/retrieval/agent.py` (`SYSTEM_PROMPT`, `HYBRID_SYSTEM_PROMPT`)
- Modify: `backend/app/retrieval/prompts.py` (`BOOK_ANSWER_SYSTEM_PROMPT`)
- Modify: `backend/app/retrieval/answerer.py` (`ModelBookAnswer.body` validator)
- Test: `backend/tests/test_book_agent.py`, `backend/tests/test_book_answerer.py` (existing files — verify they still pass; no new tests needed since neither asserts exact prompt text or the specific 1200/1800 cap value, only prompt *identity* via `assert client.calls[0]["instructions"] == SYSTEM_PROMPT`)

**Interfaces:**
- Produces: no new interfaces — this task only changes prompt text and one validator constant. Nothing downstream depends on a signature here.

- [ ] **Step 1: Update `agent.py`'s prompts**

Find this exact block in `backend/app/retrieval/agent.py`:

```python
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

HYBRID_SYSTEM_PROMPT = """\
You are a reading assistant. Answer the question by drawing on the book's evidence
and, where helpful, real-world general knowledge.

Use the same tools to gather book evidence:
- read_current_context: the page the reader is currently on.
- search_book: semantic + keyword search across the book.

Guidelines:
- Always search the book first and lead with what the book says.
- You may ALSO add real-world examples or context beyond the book.
- Clearly attribute each part: what comes from the book vs. general knowledge.
- If the book has nothing relevant, you may still answer from general knowledge —
  say so plainly. In that case set supported=true with no citations.
- Cite book source IDs only for claims drawn from the book. Cite at most 3.
- Keep the body under 1200 characters."""
```

Replace with:

```python
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
Cite at most 3. Keep the body under 1800 characters.

Formatting: write the body in clean Markdown, restricted to:
- Short paragraphs (1-3 sentences).
- "- " bullet lists for parallel or enumerated items.
- "1. " numbered lists for sequences, steps, or ranked items.
- **bold** used sparingly, for key terms or labels.
Do not use headings, tables, code blocks, blockquotes, or nested lists. Prefer
structure (a short list) over a long run-on paragraph when the answer has multiple
distinct points."""

HYBRID_SYSTEM_PROMPT = """\
You are a reading assistant. Answer the question by drawing on the book's evidence
and, where helpful, real-world general knowledge.

Use the same tools to gather book evidence:
- read_current_context: the page the reader is currently on.
- search_book: semantic + keyword search across the book.

Guidelines:
- Always search the book first and lead with what the book says.
- You may ALSO add real-world examples or context beyond the book.
- Clearly attribute each part: what comes from the book vs. general knowledge.
- If the book has nothing relevant, you may still answer from general knowledge —
  say so plainly. In that case set supported=true with no citations.
- Cite book source IDs only for claims drawn from the book. Cite at most 3.
- Keep the body under 1800 characters.

Formatting: write the body in clean Markdown, restricted to:
- Short paragraphs (1-3 sentences).
- "- " bullet lists for parallel or enumerated items.
- "1. " numbered lists for sequences, steps, or ranked items.
- **bold** used sparingly, for key terms or labels.
Do not use headings, tables, code blocks, blockquotes, or nested lists. Prefer
structure (a short list) over a long run-on paragraph when the answer has multiple
distinct points."""
```

- [ ] **Step 2: Update `prompts.py`'s `BOOK_ANSWER_SYSTEM_PROMPT`**

Find this exact block in `backend/app/retrieval/prompts.py`:

```python
BOOK_ANSWER_SYSTEM_PROMPT = """\
You are a reading assistant that answers questions using only the evidence excerpts provided.

Rules:
1. Use ONLY the supplied evidence — do not use general knowledge.
2. If the evidence does not support an answer, set supported=false and leave body empty.
3. Cite only the source IDs listed in the evidence. Do not invent IDs.
4. Cite at most 3 sources, in order of first use.
5. Keep body under 1200 characters.
"""
```

Replace with:

```python
BOOK_ANSWER_SYSTEM_PROMPT = """\
You are a reading assistant that answers questions using only the evidence excerpts provided.

Rules:
1. Use ONLY the supplied evidence — do not use general knowledge.
2. If the evidence does not support an answer, set supported=false and leave body empty.
3. Cite only the source IDs listed in the evidence. Do not invent IDs.
4. Cite at most 3 sources, in order of first use.
5. Keep body under 1800 characters.
6. Write the body in clean Markdown, restricted to: short paragraphs (1-3 sentences),
   "- " bullet lists for parallel items, "1. " numbered lists for sequences, and
   **bold** used sparingly for key terms. No headings, tables, code blocks,
   blockquotes, or nested lists.
"""
```

- [ ] **Step 3: Raise the hard length validator in `answerer.py`**

Find this exact line in `backend/app/retrieval/answerer.py`:

```python
    body: str = Field(max_length=1200)
```

Replace with:

```python
    body: str = Field(max_length=1800)
```

This is the load-bearing change — without it, a longer structured answer from the
model raises a Pydantic validation error rather than being accepted.

- [ ] **Step 4: Verify `max_output_tokens` headroom (no code change expected)**

`backend/app/retrieval/agent.py`'s `BookAgent.__init__` defaults `max_output_tokens`
to `700` (used directly in the `client.responses.parse(...)` call at
`agent.py:147`), and this is the only path actually wired into the live "Ask the
book" endpoint (`backend/app/routers/book_ask.py`'s `_build_agent`, which
constructs `BookAgent` without overriding `max_output_tokens`). At roughly 4
characters per token for English text, 700 tokens is about 2800 characters —
comfortably above the new 1800-character body cap plus the small JSON overhead
for `eyebrow`/`citation_ids`/`supported`. No change to this default is expected.

Confirm this by reading `backend/app/retrieval/agent.py` around line 78 (the
`__init__` signature) and line 147 (the `client.responses.parse` call) and
checking no other call site overrides it — `grep -rn "max_output_tokens" backend/app --include="*.py"`
should show only `agent.py`'s own default/usage and two unrelated modules
(`backend/app/mindmap/consolidator.py`, `backend/app/mindmap/extractor.py`, which
are for a different feature and out of scope here). If you find a call site that
does override `BookAgent`'s `max_output_tokens` to something lower than 700,
report it as a concern rather than silently changing it — do not modify
`max_output_tokens` as part of this task.

- [ ] **Step 5: Run the affected backend tests**

Run: `/Users/vietanh0495/projects/AI-reader-assisant/.venv/bin/python -m pytest -c backend/pytest.ini backend/tests/test_book_agent.py backend/tests/test_book_answerer.py -v`

Expected: PASS — all 15 tests (these assert prompt *identity* via
`assert client.calls[0]["instructions"] == SYSTEM_PROMPT`, not literal prompt
text or the specific cap value, so the text/cap changes in Steps 1-3 don't break
them).

Do not run the full backend suite (`backend/tests` broadly) — several unrelated
test files (`test_index_upload_api.py`, `test_worker.py`) require a live
Postgres test container that isn't available in this environment and will error
with unrelated `ModuleNotFoundError`/connection failures. This is a pre-existing
environment gap, not something this task's changes affect.

- [ ] **Step 6: Commit**

```bash
git add backend/app/retrieval/agent.py backend/app/retrieval/prompts.py backend/app/retrieval/answerer.py
git commit -m "feat(ask): instruct structured Markdown and raise the answer length cap"
```

---

### Task 2: Frontend — pure Markdown parser

**Files:**
- Create: `src/components/answerMarkdown.ts`
- Test: `src/components/answerMarkdown.test.ts`

**Interfaces:**
- Produces: `AnswerSpan = { text: string; bold?: boolean; code?: boolean }`, `AnswerBlock = { type: 'paragraph'; spans: AnswerSpan[] } | { type: 'bullet_list'; items: AnswerSpan[][] } | { type: 'numbered_list'; items: AnswerSpan[][] }`, `parseAnswerMarkdown(text: string): AnswerBlock[]` — all consumed by Task 3's `AnswerMarkdown` component.

- [ ] **Step 1: Write the failing tests**

Create `src/components/answerMarkdown.test.ts`:

```ts
import { parseAnswerMarkdown } from './answerMarkdown';

test('parses a single plain paragraph', () => {
  expect(parseAnswerMarkdown('Start early.')).toEqual([
    { type: 'paragraph', spans: [{ text: 'Start early.' }] },
  ]);
});

test('parses multiple paragraphs separated by a blank line', () => {
  const result = parseAnswerMarkdown('First paragraph.\n\nSecond paragraph.');
  expect(result).toEqual([
    { type: 'paragraph', spans: [{ text: 'First paragraph.' }] },
    { type: 'paragraph', spans: [{ text: 'Second paragraph.' }] },
  ]);
});

test('parses bold spans within a paragraph', () => {
  const result = parseAnswerMarkdown('**Compound interest** grows over time.');
  expect(result).toEqual([
    {
      type: 'paragraph',
      spans: [
        { text: 'Compound interest', bold: true },
        { text: ' grows over time.' },
      ],
    },
  ]);
});

test('parses inline code spans within a paragraph', () => {
  const result = parseAnswerMarkdown('Call `runBookAsk` to ask a question.');
  expect(result).toEqual([
    {
      type: 'paragraph',
      spans: [
        { text: 'Call ' },
        { text: 'runBookAsk', code: true },
        { text: ' to ask a question.' },
      ],
    },
  ]);
});

test('parses a bullet list', () => {
  const result = parseAnswerMarkdown('- Interest on principal\n- Interest on prior interest');
  expect(result).toEqual([
    {
      type: 'bullet_list',
      items: [
        [{ text: 'Interest on principal' }],
        [{ text: 'Interest on prior interest' }],
      ],
    },
  ]);
});

test('parses a numbered list', () => {
  const result = parseAnswerMarkdown('1. Faster growth later\n2. A bigger gap the longer you wait');
  expect(result).toEqual([
    {
      type: 'numbered_list',
      items: [
        [{ text: 'Faster growth later' }],
        [{ text: 'A bigger gap the longer you wait' }],
      ],
    },
  ]);
});

test('parses a mixed paragraph, list, and paragraph answer', () => {
  const text =
    'Compound interest grows in two ways:\n\n' +
    '- Interest on principal\n' +
    '- Interest on prior interest\n\n' +
    'Over time this creates a bigger gap.';
  const result = parseAnswerMarkdown(text);
  expect(result).toEqual([
    { type: 'paragraph', spans: [{ text: 'Compound interest grows in two ways:' }] },
    {
      type: 'bullet_list',
      items: [
        [{ text: 'Interest on principal' }],
        [{ text: 'Interest on prior interest' }],
      ],
    },
    { type: 'paragraph', spans: [{ text: 'Over time this creates a bigger gap.' }] },
  ]);
});

test('degrades an unclosed bold marker to literal text', () => {
  const result = parseAnswerMarkdown('This is **bold text without a closing marker.');
  expect(result).toEqual([
    {
      type: 'paragraph',
      spans: [{ text: 'This is **bold text without a closing marker.' }],
    },
  ]);
});

test('treats a stray asterisk or dash mid-sentence as literal text, not a list', () => {
  const result = parseAnswerMarkdown('The result is 5 * 3 - 2, which is interesting.');
  expect(result).toEqual([
    {
      type: 'paragraph',
      spans: [{ text: 'The result is 5 * 3 - 2, which is interesting.' }],
    },
  ]);
});

test('returns an empty array for an empty string', () => {
  expect(parseAnswerMarkdown('')).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/answerMarkdown.test.ts`
Expected: FAIL — cannot find module `./answerMarkdown`.

- [ ] **Step 3: Implement the minimal code**

Create `src/components/answerMarkdown.ts`:

```ts
export type AnswerSpan = { text: string; bold?: boolean; code?: boolean };

export type AnswerBlock =
  | { type: 'paragraph'; spans: AnswerSpan[] }
  | { type: 'bullet_list'; items: AnswerSpan[][] }
  | { type: 'numbered_list'; items: AnswerSpan[][] };

const BULLET_LINE = /^\s*[-*]\s+(.*)$/;
const NUMBERED_LINE = /^\s*\d+\.\s+(.*)$/;

export function parseAnswerMarkdown(text: string): AnswerBlock[] {
  const lines = text.split('\n');
  const blocks: AnswerBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE);
    if (bulletMatch) {
      const items: AnswerSpan[][] = [];
      while (i < lines.length) {
        const match = lines[i].match(BULLET_LINE);
        if (!match) {
          break;
        }
        items.push(parseInlineSpans(match[1]));
        i++;
      }
      blocks.push({ type: 'bullet_list', items });
      continue;
    }

    const numberedMatch = line.match(NUMBERED_LINE);
    if (numberedMatch) {
      const items: AnswerSpan[][] = [];
      while (i < lines.length) {
        const match = lines[i].match(NUMBERED_LINE);
        if (!match) {
          break;
        }
        items.push(parseInlineSpans(match[1]));
        i++;
      }
      blocks.push({ type: 'numbered_list', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(BULLET_LINE) &&
      !lines[i].match(NUMBERED_LINE)
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', spans: parseInlineSpans(paragraphLines.join(' ')) });
  }

  return blocks;
}

const INLINE_MARKER = /\*\*(.+?)\*\*|`(.+?)`/g;

function parseInlineSpans(text: string): AnswerSpan[] {
  const spans: AnswerSpan[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_MARKER.lastIndex = 0;
  while ((match = INLINE_MARKER.exec(text)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      spans.push({ text: match[1], bold: true });
    } else if (match[2] !== undefined) {
      spans.push({ text: match[2], code: true });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex) });
  }

  if (spans.length === 0) {
    spans.push({ text: '' });
  }

  return spans;
}
```

Note the `INLINE_MARKER.lastIndex = 0` reset before each use: the regex is
declared with the `g` flag at module scope, so it's a single shared `RegExp`
object whose `lastIndex` persists across calls — without resetting it, a second
call to `parseInlineSpans` could start scanning from where the previous call's
last match left off, silently skipping the beginning of a later string.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/answerMarkdown.test.ts`
Expected: PASS — all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/answerMarkdown.ts src/components/answerMarkdown.test.ts
git commit -m "feat(ask): add a pure parser for the answer Markdown subset"
```

---

### Task 3: Frontend — `AnswerMarkdown` renderer component

**Files:**
- Create: `src/components/AnswerMarkdown.tsx`
- Test: `src/components/AnswerMarkdown.test.tsx`

**Interfaces:**
- Consumes: `parseAnswerMarkdown`, `AnswerBlock`, `AnswerSpan` (Task 2, `./answerMarkdown`).
- Produces: `AnswerMarkdown({ text: string }): JSX.Element` — consumed by Task 4's wiring into `ConversationThread.tsx`.

This is a plain presentational component — a single `text` prop, no context
access — matching the existing `SessionExpiredBanner`/`BookSources` pattern in
this codebase. It renders no `Pressable`/touch handlers of its own, so the
parent `Pressable` in `ConversationThread.tsx` that owns the long-press
"copy / ask about this" menu keeps working unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/components/AnswerMarkdown.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { AnswerMarkdown } from './AnswerMarkdown.tsx';

test('renders a plain paragraph unchanged', async () => {
  await render(<AnswerMarkdown text="Start early." />);
  expect(screen.getByText('Start early.')).toBeTruthy();
});

test('renders a bold span with the bold style', async () => {
  await render(<AnswerMarkdown text="**Important** note." />);
  const boldNode = screen.getByText('Important');
  const flattenedStyle = Array.isArray(boldNode.props.style)
    ? Object.assign({}, ...boldNode.props.style.filter(Boolean))
    : boldNode.props.style;
  expect(flattenedStyle.fontWeight).toBe('700');
  expect(screen.getByText(/note\./)).toBeTruthy();
});

test('renders a bullet list as separate items', async () => {
  await render(<AnswerMarkdown text={'- First item\n- Second item'} />);
  expect(screen.getAllByTestId('answer-list-item')).toHaveLength(2);
  expect(screen.getByText('First item')).toBeTruthy();
  expect(screen.getByText('Second item')).toBeTruthy();
});

test('renders a numbered list with sequential markers', async () => {
  await render(<AnswerMarkdown text={'1. Step one\n2. Step two'} />);
  expect(screen.getByText('1.')).toBeTruthy();
  expect(screen.getByText('2.')).toBeTruthy();
  expect(screen.getByText('Step one')).toBeTruthy();
  expect(screen.getByText('Step two')).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/AnswerMarkdown.test.tsx`
Expected: FAIL — cannot find module `./AnswerMarkdown`.

- [ ] **Step 3: Implement the minimal code**

Create `src/components/AnswerMarkdown.tsx`:

```tsx
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { parseAnswerMarkdown, type AnswerBlock, type AnswerSpan } from './answerMarkdown';

export type AnswerMarkdownProps = {
  text: string;
};

export function AnswerMarkdown({ text }: AnswerMarkdownProps) {
  const blocks = parseAnswerMarkdown(text);

  return (
    <View>
      {blocks.map((block, blockIndex) => (
        <View key={blockIndex} style={blockIndex > 0 ? styles.blockSpacing : undefined}>
          <AnswerBlockView block={block} />
        </View>
      ))}
    </View>
  );
}

function AnswerBlockView({ block }: { block: AnswerBlock }) {
  if (block.type === 'paragraph') {
    return (
      <Text style={styles.text}>
        <AnswerSpans spans={block.spans} />
      </Text>
    );
  }

  return (
    <View>
      {block.items.map((spans, index) => (
        <View key={index} style={styles.listItem} testID="answer-list-item">
          <Text style={styles.listMarker}>{block.type === 'numbered_list' ? `${index + 1}.` : '•'}</Text>
          <Text style={styles.listItemText}>
            <AnswerSpans spans={spans} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function AnswerSpans({ spans }: { spans: AnswerSpan[] }) {
  return (
    <>
      {spans.map((span, index) => (
        <Text key={index} style={[span.bold && styles.bold, span.code && styles.code]}>
          {span.text}
        </Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  blockSpacing: {
    marginTop: 8,
  },
  text: {
    fontSize: 14,
    lineHeight: 21,
    color: '#171715',
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  listMarker: {
    fontSize: 14,
    lineHeight: 21,
    color: '#171715',
    width: 20,
  },
  listItemText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#171715',
    flex: 1,
  },
  bold: {
    fontWeight: '700',
  },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
});
```

The `fontSize: 14, lineHeight: 21, color: '#171715'` values match
`ConversationThread.tsx`'s existing `answerText` style exactly, so a plain,
markdown-free answer renders visually identical to before this change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/AnswerMarkdown.test.tsx`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/AnswerMarkdown.tsx src/components/AnswerMarkdown.test.tsx
git commit -m "feat(ask): add AnswerMarkdown renderer component"
```

---

### Task 4: Wire `AnswerMarkdown` into the Ask thread

**Files:**
- Modify: `src/components/ConversationThread.tsx`

**Interfaces:**
- Consumes: `AnswerMarkdown` (Task 3, `./AnswerMarkdown.tsx` — see Step 1 for why the explicit extension is required).

- [ ] **Step 1: Add the import**

Find this exact line in `src/components/ConversationThread.tsx`:

```ts
import { BookSources } from './BookSources';
```

Add immediately before it:

```ts
import { AnswerMarkdown } from './AnswerMarkdown.tsx';
```

Use the explicit `.tsx` extension, not the bare `./AnswerMarkdown`. This
directory also has `answerMarkdown.ts` (Task 2's parser, lowercase). On a
case-insensitive filesystem (default macOS, default Windows), both Jest's and
Metro's module resolvers try the `.ts` extension before `.tsx`, so an
extension-less `./AnswerMarkdown` import case-insensitively matches
`answerMarkdown.ts` instead of the intended `AnswerMarkdown.tsx` — the import
silently succeeds but binds to the wrong module (whose only export is
`parseAnswerMarkdown`), making `AnswerMarkdown` `undefined` and crashing at
render time with "Element type is invalid." This was discovered and verified
while implementing Task 3. The explicit extension forces exact-name resolution
with no case-insensitive false match.

- [ ] **Step 2: Replace the raw answer text with the renderer**

Find this exact line:

```tsx
                <Text style={styles.answerText}>{turn.text}</Text>
```

Replace with:

```tsx
                <AnswerMarkdown text={turn.text} />
```

- [ ] **Step 3: Remove the now-unused `answerText` style**

Find this exact block:

```ts
  answerText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#171715',
  },
```

Delete it entirely (it has no other usages — `AnswerMarkdown` owns this styling
now, matching these same values internally).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the affected frontend tests**

Run: `npx jest src/components/ConversationThread.test.tsx src/components/AnswerMarkdown.test.tsx src/components/answerMarkdown.test.tsx`
Expected: PASS — all tests, including `ConversationThread.test.tsx`'s existing
`getByText('Start early.')` assertion (a plain string with no markdown renders
as a single paragraph block containing one plain span with that exact text, so
this pre-existing test needs no changes).

- [ ] **Step 6: Run the full frontend test suite**

Run: `npx jest`
Expected: PASS — no regressions across the whole suite.

- [ ] **Step 7: Manual verification**

Neither `ConversationThread.tsx`'s wiring nor the backend prompt changes have a
way to be fully exercised by the automated suite (the backend tests use fake
clients with canned responses; the frontend tests use hardcoded text, not a
real model response) — verify end-to-end on a simulator/device once both halves
are merged:

1. Ask a question in the thread that naturally invites a list (e.g. "what are
   the main types of X?"). Confirm the answer shows real bullets and bold, with
   no literal `-`/`**` characters visible.
2. Ask something that yields plain prose. Confirm it still reads as normal
   paragraphs, unchanged from before this feature.
3. Long-press an assistant answer that contains a list. Confirm the
   "copy / ask about this" menu still appears (the renderer doesn't steal the
   gesture from the parent `Pressable`).
4. Ask a question from the mind map (quick-ask chip or "ask about this node").
   Confirm it produces a well-formatted, structured answer.
5. Confirm the inline quick-action card (explain/example/rephrase/summarize) is
   unchanged — still terse, no new formatting, since this task never touches
   `backend/app/prompts.py` or any inline-card frontend code.

- [ ] **Step 8: Commit**

```bash
git add src/components/ConversationThread.tsx
git commit -m "feat(ask): render assistant answers with Markdown formatting"
```

---

## Manual verification (recap)

Covered in Task 4, Step 7 above — this is the final task in the plan.
