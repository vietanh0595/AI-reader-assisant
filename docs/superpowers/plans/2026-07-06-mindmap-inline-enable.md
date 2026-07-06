# Mind Map Inline Enable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dead-end "Generation failed" screen shown when tapping the mind map for a book that hasn't finished Whole-Book AI, by redirecting to the existing enable/progress/retry sheet and auto-continuing into mind map generation once it's ready.

**Architecture:** `openMindMap()` currently decides "not enabled" by checking `!cloudBookId`, which is also true mid-upload and mid-indexing (cloudBookId only merges into local state once the whole pipeline resolves). Replace that with the `wholeBookAi.status !== 'ready'` check already used by two sibling call sites (`openConversationThread`, mind map's "Ask about this node" handler), redirect to the existing `WholeBookAiSheet`, and add a pending-intent + effect pair (mirroring the existing `pendingAuthenticatedAction`/`pendingQuickAsk` patterns already in `App.tsx`) that automatically resumes `openMindMap` once indexing reaches `ready`.

**Tech Stack:** React Native, TypeScript, existing `App.tsx` state/effect patterns. No new dependencies.

## Global Constraints

- No changes to `WholeBookAiSheet.tsx`, `resolveMindMapBookId`, or `shouldStartMindMapGeneration` — this is purely a wiring fix in `App.tsx`.
- Enabling must auto-continue into mind map generation with no extra user tap once indexing reaches `ready`.
- Closing the `WholeBookAiSheet` before indexing finishes must cancel the pending mind-map intent, so an unrelated later enable (e.g. via the Ask flow) doesn't unexpectedly jump the user into a mind map.
- `App.tsx` has no dedicated test file; verification is typecheck + full existing suite (regression-only) + the manual scenarios below. Do not invent a test file for this change.

---

### Task 1: Redirect mind map's enable path through the existing sheet, with auto-continue

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `libraryItems`, `activeBookId`, `activeLibraryItem` (existing state/derived value), `openLibraryItem(bookId: string)` (existing function, `App.tsx:2528`), `WholeBookAiSheet` (existing component, unchanged props), `resolveMindMapBookId` (existing, unchanged).
- Produces: nothing new for other tasks — this is the final task in this plan.

- [ ] **Step 1: Add the pending-intent state**

In `App.tsx`, right after the existing `pendingQuickAsk` state declaration (find this exact line):

```ts
  const [pendingQuickAsk, setPendingQuickAsk] = useState<{ bookId: string; question: string; allowGeneralKnowledge: boolean } | null>(null);
```

add immediately below it:

```ts
  // Set when the mind map is tapped for a book that isn't ready yet; drives the
  // WholeBookAiSheet redirect and the auto-continue effect below.
  const [pendingMindMapAfterEnable, setPendingMindMapAfterEnable] = useState<{ bookId: string; bookTitle: string } | null>(null);
```

- [ ] **Step 2: Redirect `openMindMap`'s non-ready path to the enable sheet**

Find the current start of `openMindMap` (through the `!cloudBookId` dead-end):

```ts
  async function openMindMap(bookId: string, bookTitle: string, options: { forceGenerate?: boolean } = {}) {
    // Clear any existing poll interval before starting a new one (fix: interval leak on retry)
    if (mindMapPollRef.current) {
      clearInterval(mindMapPollRef.current);
      mindMapPollRef.current = null;
    }
    // Mark any previous openMindMap call as cancelled (fix: stale async race after close)
    mindMapCancelRef.current = false;
    const cancelled = () => mindMapCancelRef.current;
    const libraryItem = libraryItems.find((item) => item.id === bookId);
    const cloudBookId = libraryItem ? resolveMindMapBookId(bookId, libraryItem.wholeBookAi) : null;

    // Reset nav + selection state when opening a different book; preserve for same book.
    if (bookId !== mindMapBookId) {
      setMindMapNavTab('concepts');
      setMindMapNavOpenChapterId(null);
      setMindMapSavedNodeId(null);
      setMindMapSavedChapterId(null);
      setMindMapSavedZooms({});
      mindMapLiveRef.current = { selectedNodeId: null, selectedChapterId: null, zoomStates: {} };
    }
    // Clear the return-chip context — user explicitly opened the map.
    setMindMapReturnBookId(null);

    setMindMapBookId(bookId);
    setMindMapBookTitle(bookTitle);
    setMindMapStatus('pending');
    setMindMapData(null);
    setMindMapError(undefined);
    setMindMapOpen(true);

    if (!cloudBookId) {
      setMindMapStatus('failed');
      setMindMapError('Upload this book for Whole-Book AI before generating a mind map.');
      return;
    }
```

Replace that whole block with:

```ts
  async function openMindMap(bookId: string, bookTitle: string, options: { forceGenerate?: boolean } = {}) {
    const libraryItem = libraryItems.find((item) => item.id === bookId);

    if (!libraryItem || libraryItem.wholeBookAi.status !== 'ready') {
      if (bookId !== activeBookId) {
        openLibraryItem(bookId);
      }
      setPendingMindMapAfterEnable({ bookId, bookTitle });
      setIsWholeBookAiOpen(true);
      return;
    }

    // Clear any existing poll interval before starting a new one (fix: interval leak on retry)
    if (mindMapPollRef.current) {
      clearInterval(mindMapPollRef.current);
      mindMapPollRef.current = null;
    }
    // Mark any previous openMindMap call as cancelled (fix: stale async race after close)
    mindMapCancelRef.current = false;
    const cancelled = () => mindMapCancelRef.current;
    const cloudBookId = resolveMindMapBookId(bookId, libraryItem.wholeBookAi);

    // Reset nav + selection state when opening a different book; preserve for same book.
    if (bookId !== mindMapBookId) {
      setMindMapNavTab('concepts');
      setMindMapNavOpenChapterId(null);
      setMindMapSavedNodeId(null);
      setMindMapSavedChapterId(null);
      setMindMapSavedZooms({});
      mindMapLiveRef.current = { selectedNodeId: null, selectedChapterId: null, zoomStates: {} };
    }
    // Clear the return-chip context — user explicitly opened the map.
    setMindMapReturnBookId(null);

    setMindMapBookId(bookId);
    setMindMapBookTitle(bookTitle);
    setMindMapStatus('pending');
    setMindMapData(null);
    setMindMapError(undefined);
    setMindMapOpen(true);

    if (!cloudBookId) {
      // Shouldn't happen — status is 'ready' only once cloudBookId is set alongside
      // it — but keep this as a type-narrowing guard and fail safe rather than call
      // the API with a null id.
      setMindMapStatus('failed');
      setMindMapError('Failed to load mind map');
      return;
    }
```

Everything after this point in `openMindMap` (the `try`/`getMindMap`/`generateMindMap`/polling body) is unchanged — leave it exactly as-is.

This moves the "not ready" decision before the mind map screen ever opens (no more flash of the dead-end failed screen), reuses the exact same condition the other two call sites already use, and keeps the rest of the generation/polling logic untouched.

- [ ] **Step 3: Cancel the pending intent when the sheet is closed**

Find the `WholeBookAiSheet` JSX:

```tsx
      {isWholeBookAiOpen ? (
        <WholeBookAiSheet
          state={activeLibraryItem.wholeBookAi}
          onClose={() => setIsWholeBookAiOpen(false)}
          onEnable={() => { void runIndexBook(); }}
          onRetry={() => { void runIndexBook(); }}
        />
      ) : null}
```

Replace the `onClose` line with:

```tsx
      {isWholeBookAiOpen ? (
        <WholeBookAiSheet
          state={activeLibraryItem.wholeBookAi}
          onClose={() => {
            setIsWholeBookAiOpen(false);
            setPendingMindMapAfterEnable(null);
          }}
          onEnable={() => { void runIndexBook(); }}
          onRetry={() => { void runIndexBook(); }}
        />
      ) : null}
```

- [ ] **Step 4: Add the auto-continue effect**

Find the existing `pendingQuickAsk` effect (it ends with this line):

```ts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuickAsk, activeBookId, activeLibraryItem]);
```

Immediately after that closing `}, [...]);` line, add:

```ts

  // Continue into mind map generation once Whole-Book AI finishes enabling, when
  // the enable flow was triggered by tapping the mind map itself (not the Ask flow).
  useEffect(() => {
    if (!pendingMindMapAfterEnable) {
      return;
    }
    if (activeBookId !== pendingMindMapAfterEnable.bookId) {
      return;
    }
    if (activeLibraryItem.wholeBookAi.status !== 'ready') {
      return;
    }
    const { bookId, bookTitle } = pendingMindMapAfterEnable;
    setPendingMindMapAfterEnable(null);
    setIsWholeBookAiOpen(false);
    void openMindMap(bookId, bookTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMindMapAfterEnable, activeBookId, activeLibraryItem]);
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx jest`
Expected: PASS — all existing suites unaffected (this change has no dedicated test file; this run is a regression check only).

- [ ] **Step 7: Manual verification**

`App.tsx` has no dedicated test file, so verify these four scenarios by hand on a simulator/device before committing (per the design doc's Testing section):

1. **Never enabled:** open a freshly-imported book that has never had Whole-Book AI enabled, tap the mind map entry point. Expect: the enable sheet opens (not the old "Generation failed" screen) showing "Enable whole-book AI". Tap enable, watch it progress through uploading/indexing, and once it reaches ready, confirm the sheet closes and mind map generation starts automatically with no extra tap.
2. **Mid-indexing:** enable Whole-Book AI via the Ask flow for a different book, close the sheet while it's still indexing, then tap that book's mind map entry point. Expect: the sheet reopens showing the in-progress indexing (not the dead-end message), and once it reaches ready, the same auto-continue as scenario 1 fires.
3. **Previously failed:** get a book into a failed indexing state (e.g. disconnect network mid-index), tap its mind map entry point. Expect: the sheet shows the failure and Retry button. Tap Retry; once it succeeds, confirm auto-continue into mind map generation.
4. **Abandoned intent:** on a never-enabled book, tap the mind map entry point, then close the sheet (✕ or backdrop tap) before enabling. Confirm no mind map opens. Then enable Whole-Book AI for that same book via the Ask flow instead. Confirm the mind map does *not* auto-open afterward (the abandoned intent was correctly cleared).

- [ ] **Step 8: Commit**

```bash
git add App.tsx
git commit -m "feat(mindmap): enable Whole-Book AI inline and auto-continue to generation"
```

---

## Manual verification (recap)

Covered in Task 1, Step 7 above — this plan has a single task, so there's no separate final verification phase.
