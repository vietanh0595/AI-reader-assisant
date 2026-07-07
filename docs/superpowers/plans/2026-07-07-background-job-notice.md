# Background Job Completion Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the user when indexing or mind map generation finishes while they've navigated away, backgrounded, or fully closed the app, via a global dismissible banner.

**Architecture:** Reuse the `AppState`-driven proactive-check pattern already built for session expiry (`src/auth/AuthProvider.tsx`): a new effect fires once at launch and on every foreground transition, checking any book with unresolved indexing/mind-map work. Indexing already runs to completion regardless of screen state (its async chain isn't tied to any screen) — it just needs a way to notice completion and to resume after a killed app. Mind map generation's polling is intentionally tied to its screen and stops when closed — for that job kind, completion is caught only by the new resume-check, not live. A new per-book persisted `pendingNotice` field feeds a single shared banner component.

**Tech Stack:** React Native, TypeScript, existing `App.tsx` state/effect patterns, Jest + `@testing-library/react-native` for the two new isolated files.

## Global Constraints

- OS-level push notifications are explicitly out of scope for this iteration — documented as future work only, not implemented.
- No continuously-running background timer — every check is a one-shot call anchored to app launch or an `AppState` `'active'` transition.
- The banner is a single slot, not a stack — multiple concurrent completions are shown one at a time, oldest (`notifiedAt`) first, advancing automatically as each is viewed or dismissed.
- No `pendingNotice` is ever set for a book whose relevant sheet/screen is the one currently open and showing the result live.
- `LibraryItem`'s new fields (`mindMapJob`, `pendingNotice`) are optional — no `LIBRARY_SCHEMA_VERSION` bump or migration.

---

### Task 1: Data model + pure notice-selection helper

**Files:**
- Create: `src/rag/backgroundNotice.ts`
- Test: `src/rag/backgroundNotice.test.ts`
- Modify: `App.tsx` (the `LibraryItem` type only, plus its new import)

**Interfaces:**
- Produces: `BackgroundJobKind = 'indexing' | 'mindmap'`, `BackgroundJobResultStatus = 'ready' | 'failed'`, `PersistedPendingNotice = { kind: BackgroundJobKind; status: BackgroundJobResultStatus; notifiedAt: string }`, `SelectedPendingNotice = { bookId: string; bookTitle: string; kind: BackgroundJobKind; status: BackgroundJobResultStatus }`, `selectPendingNotice(libraryItems): SelectedPendingNotice | null` — all consumed by Tasks 2, 3, 4, 5.

- [ ] **Step 1: Write the failing tests**

Create `src/rag/backgroundNotice.test.ts`:

```ts
import { selectPendingNotice } from './backgroundNotice';

test('returns null when no library items have a pending notice', () => {
  const result = selectPendingNotice([
    { id: 'book-1', book: { title: 'Book One' } },
    { id: 'book-2', book: { title: 'Book Two' } },
  ]);

  expect(result).toBeNull();
});

test('returns the single pending notice when only one exists', () => {
  const result = selectPendingNotice([
    { id: 'book-1', book: { title: 'Book One' } },
    {
      id: 'book-2',
      book: { title: 'Book Two' },
      pendingNotice: { kind: 'indexing', status: 'ready', notifiedAt: '2026-07-07T10:00:00.000Z' },
    },
  ]);

  expect(result).toEqual({
    bookId: 'book-2',
    bookTitle: 'Book Two',
    kind: 'indexing',
    status: 'ready',
  });
});

test('returns the oldest notice by notifiedAt when multiple exist', () => {
  const result = selectPendingNotice([
    {
      id: 'book-1',
      book: { title: 'Newer Book' },
      pendingNotice: { kind: 'mindmap', status: 'ready', notifiedAt: '2026-07-07T12:00:00.000Z' },
    },
    {
      id: 'book-2',
      book: { title: 'Older Book' },
      pendingNotice: { kind: 'indexing', status: 'failed', notifiedAt: '2026-07-07T09:00:00.000Z' },
    },
  ]);

  expect(result).toEqual({
    bookId: 'book-2',
    bookTitle: 'Older Book',
    kind: 'indexing',
    status: 'failed',
  });
});

test('ignores library items without a pending notice when others have one', () => {
  const result = selectPendingNotice([
    { id: 'book-1', book: { title: 'Untouched Book' } },
    {
      id: 'book-2',
      book: { title: 'Ready Book' },
      pendingNotice: { kind: 'mindmap', status: 'ready', notifiedAt: '2026-07-07T08:00:00.000Z' },
    },
  ]);

  expect(result?.bookId).toBe('book-2');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/rag/backgroundNotice.test.ts`
Expected: FAIL — cannot find module `./backgroundNotice`.

- [ ] **Step 3: Implement the minimal code**

Create `src/rag/backgroundNotice.ts`:

```ts
export type BackgroundJobKind = 'indexing' | 'mindmap';
export type BackgroundJobResultStatus = 'ready' | 'failed';

export type PersistedPendingNotice = {
  kind: BackgroundJobKind;
  status: BackgroundJobResultStatus;
  notifiedAt: string;
};

export type SelectedPendingNotice = {
  bookId: string;
  bookTitle: string;
  kind: BackgroundJobKind;
  status: BackgroundJobResultStatus;
};

export function selectPendingNotice(
  libraryItems: Array<{
    id: string;
    book: { title: string };
    pendingNotice?: PersistedPendingNotice;
  }>,
): SelectedPendingNotice | null {
  const withNotice = libraryItems.filter(
    (item): item is typeof item & { pendingNotice: PersistedPendingNotice } =>
      item.pendingNotice !== undefined,
  );

  if (withNotice.length === 0) {
    return null;
  }

  const oldest = withNotice.reduce((earliest, item) =>
    item.pendingNotice.notifiedAt < earliest.pendingNotice.notifiedAt ? item : earliest,
  );

  return {
    bookId: oldest.id,
    bookTitle: oldest.book.title,
    kind: oldest.pendingNotice.kind,
    status: oldest.pendingNotice.status,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/rag/backgroundNotice.test.ts`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Add the new fields to `LibraryItem` in `App.tsx`**

Find the `LibraryItem` type:

```ts
type LibraryItem = {
  book: ReaderBook;
  conversation: ConversationTurn[];
  id: string;
  importedAt: string;
  lastOpenedAt: string;
  readingLocation: ReadingLocation | null;
  savedInsights: SavedInsight[];
  wholeBookAi: WholeBookAiState;
};
```

Replace with:

```ts
type LibraryItem = {
  book: ReaderBook;
  conversation: ConversationTurn[];
  id: string;
  importedAt: string;
  lastOpenedAt: string;
  mindMapJob?: { status: 'generating' | 'ready' | 'failed' };
  pendingNotice?: PersistedPendingNotice;
  readingLocation: ReadingLocation | null;
  savedInsights: SavedInsight[];
  wholeBookAi: WholeBookAiState;
};
```

Find this import line:

```ts
import type { WholeBookAiState } from './src/rag/types';
```

Add immediately after it:

```ts
import { selectPendingNotice, type PersistedPendingNotice } from './src/rag/backgroundNotice';
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`selectPendingNotice` is imported but not yet called — that's fine, it will be used starting in Task 5. `PersistedPendingNotice` is used immediately by the `LibraryItem` type change.)

- [ ] **Step 7: Commit**

```bash
git add src/rag/backgroundNotice.ts src/rag/backgroundNotice.test.ts App.tsx
git commit -m "feat(mindmap): add background job notice data model and selector"
```

---

### Task 2: `BackgroundJobBanner` component

**Files:**
- Create: `src/components/BackgroundJobBanner.tsx`
- Test: `src/components/BackgroundJobBanner.test.tsx`

**Interfaces:**
- Consumes: `SelectedPendingNotice` (from Task 1, `src/rag/backgroundNotice.ts`).
- Produces: `BackgroundJobBanner({ notice: SelectedPendingNotice | null; onDismiss: () => void; onView: () => void }): JSX.Element | null` — consumed by Task 5's `App.tsx` wiring.

This is a plain presentational component — props only, no context access — matching the existing `SessionExpiredBanner`/`SignInSheet` pattern in this codebase, so it's testable in isolation. It uses `useSafeAreaInsets()` the same way `SessionExpiredBanner` does, so it doesn't render under the status bar.

- [ ] **Step 1: Write the failing tests**

Create `src/components/BackgroundJobBanner.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BackgroundJobBanner } from './BackgroundJobBanner';

const metrics = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const renderBanner = (ui: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

test('renders nothing when there is no pending notice', async () => {
  const screen = await renderBanner(
    <BackgroundJobBanner notice={null} onDismiss={jest.fn()} onView={jest.fn()} />,
  );
  expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
});

test('shows a ready notice and fires onView', async () => {
  const onView = jest.fn();
  const screen = await renderBanner(
    <BackgroundJobBanner
      notice={{ bookId: 'book-1', bookTitle: 'Deep Work', kind: 'indexing', status: 'ready' }}
      onDismiss={jest.fn()}
      onView={onView}
    />,
  );
  expect(screen.getByText("'Deep Work' is ready")).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'View' }));
  expect(onView).toHaveBeenCalledTimes(1);
});

test('shows a failed indexing notice with the right copy', async () => {
  const screen = await renderBanner(
    <BackgroundJobBanner
      notice={{ bookId: 'book-1', bookTitle: 'Deep Work', kind: 'indexing', status: 'failed' }}
      onDismiss={jest.fn()}
      onView={jest.fn()}
    />,
  );
  expect(screen.getByText("Indexing for 'Deep Work' failed")).toBeTruthy();
});

test('shows a failed mind map notice with the right copy', async () => {
  const screen = await renderBanner(
    <BackgroundJobBanner
      notice={{ bookId: 'book-1', bookTitle: 'Deep Work', kind: 'mindmap', status: 'failed' }}
      onDismiss={jest.fn()}
      onView={jest.fn()}
    />,
  );
  expect(screen.getByText("Mind map for 'Deep Work' failed")).toBeTruthy();
});

test('calls onDismiss when the dismiss button is pressed', async () => {
  const onDismiss = jest.fn();
  const screen = await renderBanner(
    <BackgroundJobBanner
      notice={{ bookId: 'book-1', bookTitle: 'Deep Work', kind: 'indexing', status: 'ready' }}
      onDismiss={onDismiss}
      onView={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/BackgroundJobBanner.test.tsx`
Expected: FAIL — cannot find module `./BackgroundJobBanner`.

- [ ] **Step 3: Implement the minimal code**

Create `src/components/BackgroundJobBanner.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SelectedPendingNotice } from '../rag/backgroundNotice';

export type BackgroundJobBannerProps = {
  notice: SelectedPendingNotice | null;
  onDismiss: () => void;
  onView: () => void;
};

function bannerCopy(notice: SelectedPendingNotice): string {
  if (notice.status === 'ready') {
    return `'${notice.bookTitle}' is ready`;
  }
  const jobLabel = notice.kind === 'indexing' ? 'Indexing' : 'Mind map';
  return `${jobLabel} for '${notice.bookTitle}' failed`;
}

export function BackgroundJobBanner({ notice, onDismiss, onView }: BackgroundJobBannerProps) {
  const insets = useSafeAreaInsets();

  if (!notice) {
    return null;
  }

  return (
    <View style={[styles.banner, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.text}>{bannerCopy(notice)}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onView} style={styles.viewButton}>
          <Text style={styles.viewText}>View</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.dismissButton}
        >
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    backgroundColor: '#2d6a4f',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  text: {
    color: '#ffffff',
    flex: 1,
    fontSize: 13,
    marginRight: 12,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  viewButton: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  viewText: {
    color: '#2d6a4f',
    fontSize: 13,
    fontWeight: '600',
  },
  dismissButton: {
    padding: 4,
  },
  dismissText: {
    color: '#ffffff',
    fontSize: 16,
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/BackgroundJobBanner.test.tsx`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/BackgroundJobBanner.tsx src/components/BackgroundJobBanner.test.tsx
git commit -m "feat(mindmap): add BackgroundJobBanner component"
```

---

### Task 3: Generalize `runIndexBook` and set `pendingNotice` on the live path

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `PersistedPendingNotice` (Task 1).
- Produces: `runIndexBookFor(libraryItem: LibraryItem): Promise<void>` — consumed by Task 4's resume-check effect.

- [ ] **Step 1: Add refs for "is this book's sheet currently open and watching"**

Find:

```ts
  const [isWholeBookAiOpen, setIsWholeBookAiOpen] = useState(false);
```

Replace with:

```ts
  const [isWholeBookAiOpen, setIsWholeBookAiOpen] = useState(false);
  // Read inside runIndexBookFor's async resolution to decide whether the sheet is
  // currently showing this exact book's result live (skip the notice if so) — refs
  // avoid stale closures, since the indexing promise can resolve long after the user
  // has navigated to a different book or closed the sheet.
  const isWholeBookAiOpenRef = useRef(isWholeBookAiOpen);
  isWholeBookAiOpenRef.current = isWholeBookAiOpen;
  const activeBookIdRef = useRef(activeBookId);
  activeBookIdRef.current = activeBookId;
```

- [ ] **Step 2: Generalize `runIndexBook` into `runIndexBookFor` and add notice-setting**

Find the full current function:

```ts
  async function runIndexBook() {
    const token = await getAccessToken();
    if (!token) {
      // Close the Book AI sheet first so the sign-in prompt isn't hidden behind it.
      setIsWholeBookAiOpen(false);
      setIsSignInOpen(true);
      return;
    }

    const client = {
      fetch(path: string, init?: RequestInit) {
        return fetch(`${apiBaseUrl}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        });
      },
    };
    const api = createIndexApi(client);

    const bookParagraphs = currentBook.paragraphs.map((p) => ({
      id: p.id,
      blockKind: (p.blockKind ?? 'body') as import('./src/rag/types').UploadBlock['blockKind'],
      text: p.segments.map((s) => s.text).join(''),
      sourceRef: p.sourceRef ?? { source: currentBook.source === 'sample' ? 'epub' : (currentBook.source as import('./src/rag/types').DocumentSource) },
      chapterId: undefined as string | undefined,
      chapterTitle: undefined as string | undefined,
    }));

    // Annotate each paragraph with its chapter
    let chapterIdx = 0;
    for (let i = 0; i < bookParagraphs.length; i++) {
      while (
        chapterIdx + 1 < currentBook.chapters.length &&
        currentBook.paragraphs.findIndex((p) => p.id === currentBook.chapters[chapterIdx + 1].paragraphId) <= i
      ) {
        chapterIdx++;
      }
      const chapter = currentBook.chapters[chapterIdx];
      if (chapter) {
        bookParagraphs[i].chapterId = chapter.id;
        bookParagraphs[i].chapterTitle = chapter.title;
      }
    }

    const activeId = activeLibraryItem.id;
    setLibraryItems((items) =>
      items.map((item) =>
        item.id === activeId
          ? { ...item, wholeBookAi: { ...item.wholeBookAi, status: 'uploading', error: undefined } }
          : item,
      ),
    );
    // Keep the sheet open so the user sees Uploading → Indexing → Ready progress.

    try {
      const nextState = await indexBook({
        api,
        book: {
          paragraphs: bookParagraphs,
          title: currentBook.title,
          author: currentBook.author,
          source: currentBook.source === 'sample' ? 'epub' : (currentBook.source as 'epub' | 'pdf' | 'scan'),
          clientBookId: activeLibraryItem.id,
          fileName: currentBook.fileName,
        },
        localState: activeLibraryItem.wholeBookAi.cloudBookId ? activeLibraryItem.wholeBookAi : null,
        onProgress: (progress) => {
          setLibraryItems((items) =>
            items.map((item) =>
              item.id === activeId
                ? { ...item, wholeBookAi: { ...item.wholeBookAi, progress } }
                : item,
            ),
          );
        },
      });

      setLibraryItems((items) =>
        items.map((item) =>
          item.id === activeId ? { ...item, wholeBookAi: nextState } : item,
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? `Indexing failed: ${error.message}`
          : 'Indexing failed. Check your connection and try again.';
      setLibraryItems((items) =>
        items.map((item) =>
          item.id === activeId
            ? { ...item, wholeBookAi: { ...item.wholeBookAi, status: 'failed', error: message } }
            : item,
        ),
      );
    }
  }
```

Replace the entire function with:

```ts
  async function runIndexBookFor(libraryItem: LibraryItem) {
    const token = await getAccessToken();
    if (!token) {
      // Close the Book AI sheet first so the sign-in prompt isn't hidden behind it.
      setIsWholeBookAiOpen(false);
      setIsSignInOpen(true);
      return;
    }

    const client = {
      fetch(path: string, init?: RequestInit) {
        return fetch(`${apiBaseUrl}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        });
      },
    };
    const api = createIndexApi(client);
    const book = libraryItem.book;

    const bookParagraphs = book.paragraphs.map((p) => ({
      id: p.id,
      blockKind: (p.blockKind ?? 'body') as import('./src/rag/types').UploadBlock['blockKind'],
      text: p.segments.map((s) => s.text).join(''),
      sourceRef: p.sourceRef ?? { source: book.source === 'sample' ? 'epub' : (book.source as import('./src/rag/types').DocumentSource) },
      chapterId: undefined as string | undefined,
      chapterTitle: undefined as string | undefined,
    }));

    // Annotate each paragraph with its chapter
    let chapterIdx = 0;
    for (let i = 0; i < bookParagraphs.length; i++) {
      while (
        chapterIdx + 1 < book.chapters.length &&
        book.paragraphs.findIndex((p) => p.id === book.chapters[chapterIdx + 1].paragraphId) <= i
      ) {
        chapterIdx++;
      }
      const chapter = book.chapters[chapterIdx];
      if (chapter) {
        bookParagraphs[i].chapterId = chapter.id;
        bookParagraphs[i].chapterTitle = chapter.title;
      }
    }

    const activeId = libraryItem.id;
    setLibraryItems((items) =>
      items.map((item) =>
        item.id === activeId
          ? { ...item, wholeBookAi: { ...item.wholeBookAi, status: 'uploading', error: undefined } }
          : item,
      ),
    );
    // Keep the sheet open so the user sees Uploading → Indexing → Ready progress.

    const isBeingWatched = () =>
      isWholeBookAiOpenRef.current && activeBookIdRef.current === activeId;

    try {
      const nextState = await indexBook({
        api,
        book: {
          paragraphs: bookParagraphs,
          title: book.title,
          author: book.author,
          source: book.source === 'sample' ? 'epub' : (book.source as 'epub' | 'pdf' | 'scan'),
          clientBookId: libraryItem.id,
          fileName: book.fileName,
        },
        localState: libraryItem.wholeBookAi.cloudBookId ? libraryItem.wholeBookAi : null,
        onProgress: (progress) => {
          setLibraryItems((items) =>
            items.map((item) =>
              item.id === activeId
                ? { ...item, wholeBookAi: { ...item.wholeBookAi, progress } }
                : item,
            ),
          );
        },
      });

      setLibraryItems((items) =>
        items.map((item) =>
          item.id === activeId
            ? {
                ...item,
                wholeBookAi: nextState,
                pendingNotice: isBeingWatched()
                  ? item.pendingNotice
                  : {
                      kind: 'indexing',
                      status: nextState.status === 'ready' ? 'ready' : 'failed',
                      notifiedAt: new Date().toISOString(),
                    },
              }
            : item,
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? `Indexing failed: ${error.message}`
          : 'Indexing failed. Check your connection and try again.';
      setLibraryItems((items) =>
        items.map((item) =>
          item.id === activeId
            ? {
                ...item,
                wholeBookAi: { ...item.wholeBookAi, status: 'failed', error: message },
                pendingNotice: isBeingWatched()
                  ? item.pendingNotice
                  : { kind: 'indexing', status: 'failed', notifiedAt: new Date().toISOString() },
              }
            : item,
        ),
      );
    }
  }

  async function runIndexBook() {
    return runIndexBookFor(activeLibraryItem);
  }
```

The existing `onEnable`/`onRetry` callers of `runIndexBook()` need no changes — it's now a one-line wrapper with identical behavior for the active book.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx jest`
Expected: PASS — all existing suites unaffected (this is a behavior-preserving refactor for the existing caller, plus new notice-setting logic with no dedicated test file for `App.tsx`; this run is a regression check).

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "refactor(mindmap): generalize runIndexBook to target any library item"
```

---

### Task 4: Track mind map jobs per book and add the launch/foreground resume-check

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `runIndexBookFor(libraryItem)` (Task 3), `getMindMap` (existing, from `./src/rag/mindmapApi`).
- Produces: nothing new for other tasks — Task 5 only consumes the `pendingNotice`/`mindMapJob` data these writes produce, via `libraryItems` itself.

- [ ] **Step 1: Import `AppState`**

Find the `react-native` import block:

```ts
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
```

Replace with:

```ts
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
```

- [ ] **Step 2: Persist `mindMapJob` when generation starts**

Find, inside `openMindMap`:

```ts
      // Not ready — trigger generation
      await generateMindMap(apiBaseUrl, cloudBookId, token);

      if (cancelled()) return;

      setMindMapStatus('generating');
```

Replace with:

```ts
      // Not ready — trigger generation
      await generateMindMap(apiBaseUrl, cloudBookId, token);

      if (cancelled()) return;

      setMindMapStatus('generating');
      setLibraryItems((items) =>
        items.map((item) =>
          item.id === bookId ? { ...item, mindMapJob: { status: 'generating' } } : item,
        ),
      );
```

- [ ] **Step 3: Add the resume-check effect**

Find the `pendingMindMapAfterEnable` effect (it ends with this line — added in the mind-map inline-enable feature):

```ts
  }, [pendingMindMapAfterEnable, activeBookId, activeLibraryItem]);
```

Immediately after that closing `}, [...]);` line, add:

```ts

  // Mirrors libraryItems/mindMapOpen/mindMapBookId so checkBackgroundJobs and its
  // "is this book being watched live" check always read current values, without
  // needing them in the effect's dependency array below — that would tear down and
  // re-subscribe the AppState listener far more often than a launch/foreground tick.
  const libraryItemsRef = useRef(libraryItems);
  libraryItemsRef.current = libraryItems;
  const mindMapOpenRef = useRef(mindMapOpen);
  mindMapOpenRef.current = mindMapOpen;
  const mindMapBookIdRef = useRef(mindMapBookId);
  mindMapBookIdRef.current = mindMapBookId;

  async function checkBackgroundJobs() {
    const token = await getAccessToken();
    if (!token) {
      return;
    }
    for (const item of libraryItemsRef.current) {
      if (
        item.wholeBookAi.status === 'uploading' ||
        item.wholeBookAi.status === 'queued' ||
        item.wholeBookAi.status === 'indexing'
      ) {
        void runIndexBookFor(item);
      }

      if (item.mindMapJob?.status === 'generating' && item.wholeBookAi.cloudBookId) {
        const isBeingWatched =
          mindMapOpenRef.current && mindMapBookIdRef.current === item.id;
        try {
          const result = await getMindMap(apiBaseUrl, item.wholeBookAi.cloudBookId, token);
          if (result.status !== 'generating' && result.status !== 'pending') {
            const resolvedStatus: 'ready' | 'failed' = result.status === 'ready' ? 'ready' : 'failed';
            const bookId = item.id;
            setLibraryItems((items) =>
              items.map((i) =>
                i.id === bookId
                  ? {
                      ...i,
                      mindMapJob: { status: resolvedStatus },
                      pendingNotice: isBeingWatched
                        ? i.pendingNotice
                        : { kind: 'mindmap', status: resolvedStatus, notifiedAt: new Date().toISOString() },
                    }
                  : i,
              ),
            );
          }
        } catch {
          // Leave the job as 'generating' — it'll be checked again on the next
          // launch/foreground tick.
        }
      }
    }
  }

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }
    void checkBackgroundJobs();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void checkBackgroundJobs();
      }
    });
    return () => {
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading]);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx jest`
Expected: PASS — no regressions (no dedicated test file for this `App.tsx` logic; this run is a regression check).

- [ ] **Step 6: Commit**

```bash
git add App.tsx
git commit -m "feat(mindmap): persist mind map job status and add background resume-check"
```

---

### Task 5: Wire the banner into `App.tsx`

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `selectPendingNotice` (Task 1), `BackgroundJobBanner` (Task 2), `openLibraryItem`/`openMindMap`/`setIsWholeBookAiOpen` (existing).

- [ ] **Step 1: Add the import**

Find:

```ts
import { SessionExpiredBanner } from './src/components/SessionExpiredBanner';
```

Add immediately after it:

```ts
import { BackgroundJobBanner } from './src/components/BackgroundJobBanner';
```

- [ ] **Step 2: Add a shared notice-clearing helper and the derived notice**

Find the `activeLibraryItem` derivation:

```ts
  const activeLibraryItem = useMemo(
    () => getActiveLibraryItem(libraryItems, activeBookId),
    [activeBookId, libraryItems],
  );
```

Add immediately after it:

```ts
  const pendingNotice = selectPendingNotice(libraryItems);

  function clearPendingNoticeOfKind(bookId: string, kind: 'indexing' | 'mindmap') {
    setLibraryItems((items) =>
      items.map((item) =>
        item.id === bookId && item.pendingNotice?.kind === kind
          ? { ...item, pendingNotice: undefined }
          : item,
      ),
    );
  }
```

- [ ] **Step 3: Render the banner**

Find the `SessionExpiredBanner` JSX:

```tsx
      <SessionExpiredBanner
        onDismiss={dismissSessionExpiredNotice}
        onSignIn={() => setIsSignInOpen(true)}
        sessionExpired={sessionExpired && !isSignInOpen}
      />
```

Add immediately after it:

```tsx

      <BackgroundJobBanner
        notice={pendingNotice}
        onDismiss={() => {
          if (pendingNotice) {
            clearPendingNoticeOfKind(pendingNotice.bookId, pendingNotice.kind);
          }
        }}
        onView={() => {
          if (!pendingNotice) {
            return;
          }
          const { bookId, bookTitle, kind } = pendingNotice;
          clearPendingNoticeOfKind(bookId, kind);
          openLibraryItem(bookId);
          if (kind === 'indexing') {
            setIsWholeBookAiOpen(true);
          } else {
            void openMindMap(bookId, bookTitle);
          }
        }}
      />
```

- [ ] **Step 4: Clear notices when the user organically views the result**

Find the resume-check effect added in Task 4 (it ends with this line):

```ts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading]);
```

Immediately after that closing `}, [...]);` line, add:

```ts

  // Opening the sheet for a book with an unseen indexing notice implicitly shows
  // the result live — clear the notice so the banner doesn't also appear for it.
  useEffect(() => {
    if (!isWholeBookAiOpen) {
      return;
    }
    clearPendingNoticeOfKind(activeBookId, 'indexing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWholeBookAiOpen, activeBookId]);

  // Same idea for the mind map screen.
  useEffect(() => {
    if (!mindMapOpen || !mindMapBookId) {
      return;
    }
    clearPendingNoticeOfKind(mindMapBookId, 'mindmap');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mindMapOpen, mindMapBookId]);
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx jest`
Expected: PASS — all suites, including the two new files from Tasks 1 and 2.

- [ ] **Step 7: Manual verification**

`App.tsx` has no dedicated test file for this integration, so verify these scenarios by hand on a simulator/device before considering the feature done (per the design doc's Testing section):

1. Enable Whole-Book AI, close the sheet immediately, keep reading in-app. Confirm the banner appears once indexing finishes (same session, no backgrounding).
2. Start a mind map generating, close the mind map screen, keep reading in-app without backgrounding. Confirm the banner does **not** appear yet. Background and re-foreground the app once generation has actually finished server-side. Confirm the banner now appears.
3. Start indexing, force-quit the app mid-upload, relaunch. Confirm indexing resumes automatically (no need to reopen the sheet) and the banner appears once it finishes.
4. Start a mind map generating, force-quit the app, relaunch after it's finished server-side. Confirm the banner appears without reopening the mind map screen.
5. Start two different books indexing/generating concurrently, background the app, wait for both to finish, foreground. Confirm the banner shows one at a time (oldest first) and advances to the second after dismissing/viewing the first.
6. Tap "View" on a ready indexing notice — confirm it opens the sheet showing the ready state, not a fresh enable flow. Tap "View" on a ready mind map notice — confirm it shows the already-generated result, not a regeneration.
7. As a guest who has never enabled anything: confirm the banner never appears.

- [ ] **Step 8: Commit**

```bash
git add App.tsx
git commit -m "feat(mindmap): show a banner when background jobs finish"
```

---

## Manual verification (recap)

Covered in Task 5, Step 7 above — this is the final task in the plan.
