# Mind Map Live Background Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let mind map generation keep running to completion independent of the mind-map screen, so the background-job-notice banner can catch a completion the moment it happens in-app, not just on the next foreground/relaunch.

**Architecture:** Replace the single screen-owned poll (`mindMapPollRef`/`mindMapCancelRef`, cancelled by `closeMindMap`) with a per-book async polling loop (`pollMindMapUntilDone`) guarded by an in-flight `Set`, mirroring the pattern indexing already uses successfully (`runIndexBookFor`/`inFlightIndexingRef`). Screen-only state writes gate on "is this book's screen still the active one"; persisted writes (`mindMapJob`, `pendingNotice`) always apply, matching indexing's existing split.

**Tech Stack:** React Native, TypeScript, existing `App.tsx` state/effect patterns. No new dependencies.

## Global Constraints

- `App.tsx` has no dedicated test file — verification is typecheck + full existing suite (regression-only) + manual on-device scenarios, consistent with the rest of the background-job-notice feature.
- The poll loop must give up gracefully after a cap (200 attempts at 3s intervals, ~10 minutes — matching `src/rag/indexBook.ts`'s existing `_POLL_MAX_ATTEMPTS`/`_POLL_INTERVAL_MS`) rather than polling forever.
- Persisted writes (`mindMapJob`, `pendingNotice`) must always apply regardless of what's on screen; screen-only writes (`mindMapStatus`, `mindMapData`, `mindMapError`) must only apply if that exact book's mind-map screen is still the one open.
- No `pendingNotice` may be set for a book whose mind-map screen is the one currently open and showing the result live — this must keep matching the existing `mindMapOpenRef`/`mindMapBookIdRef`-based check already used elsewhere in this file.

---

### Task 1: Replace the screen-owned poll with a per-book background loop

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `mindMapOpenRef`, `mindMapBookIdRef` (existing refs, from the background-job-notice feature's Task 4), `getMindMap`/`generateMindMap` (existing, from `./src/rag/mindmapApi`), `shouldStartMindMapGeneration`/`resolveMindMapBookId` (existing, from `./src/rag/mindmapTarget`).
- Produces: `pollMindMapUntilDone(bookId: string, cloudBookId: string): Promise<void>` — consumed by this same task's rewritten `openMindMap`, and by Task 2's rewritten `checkBackgroundJobs`.

- [ ] **Step 1: Replace the poll refs with an in-flight guard**

Find this exact block:

```ts
  const mindMapPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mindMapCancelRef = useRef(false);
```

Replace with:

```ts
  // Tracks library item ids with an in-flight pollMindMapUntilDone loop, so
  // reopening a still-generating book's screen (or a resume-check tick) can't
  // start a second overlapping poll loop for the same book.
  const mindMapInFlightRef = useRef<Set<string>>(new Set());
```

- [ ] **Step 2: Add `pollMindMapUntilDone` and rewrite `openMindMap`/`closeMindMap`**

Find this exact block (the full body of `openMindMap` through the start of `closeMindMap`):

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

    try {
      const token = await getAccessToken();

      if (cancelled()) return;

      if (!token) {
        setMindMapOpen(false);
        setIsSignInOpen(true);
        return;
      }

      // Check current status
      const current = await getMindMap(apiBaseUrl, cloudBookId, token);

      if (cancelled()) return;

      if (!shouldStartMindMapGeneration(current.status, options.forceGenerate ?? false)) {
        setMindMapStatus(current.status);
        setMindMapData(current.data ?? null);
        setMindMapError(current.error);
        return;
      }

      // Not ready — trigger generation
      await generateMindMap(apiBaseUrl, cloudBookId, token);

      if (cancelled()) return;

      setMindMapStatus('generating');
      setLibraryItems((items) =>
        items.map((item) =>
          item.id === bookId ? { ...item, mindMapJob: { status: 'generating' } } : item,
        ),
      );

      // Poll every 3 seconds
      mindMapPollRef.current = setInterval(async () => {
        if (cancelled()) {
          clearInterval(mindMapPollRef.current!);
          mindMapPollRef.current = null;
          return;
        }
        try {
          const pollToken = await getAccessToken();
          if (!pollToken) {
            return;
          }
          const poll = await getMindMap(apiBaseUrl, cloudBookId, pollToken);
          if (cancelled()) return;
          if (poll.status !== 'generating' && poll.status !== 'pending') {
            clearInterval(mindMapPollRef.current!);
            mindMapPollRef.current = null;
            setMindMapStatus(poll.status);
            setMindMapData(poll.data ?? null);
            setMindMapError(poll.error);
            setLibraryItems((items) =>
              items.map((item) =>
                item.id === bookId
                  ? { ...item, mindMapJob: { status: poll.status === 'ready' ? 'ready' : 'failed' } }
                  : item,
              ),
            );
          }
        } catch {
          // ignore poll errors
        }
      }, 3000);
    } catch (err) {
      if (cancelled()) return;
      setMindMapStatus('failed');
      setMindMapError(err instanceof Error ? err.message : 'Failed to load mind map');
    }
  }

  function closeMindMap() {
    mindMapCancelRef.current = true; // cancel any in-flight openMindMap async body
    if (mindMapPollRef.current) {
      clearInterval(mindMapPollRef.current);
      mindMapPollRef.current = null;
    }
```

Replace with:

```ts
  const MIND_MAP_POLL_INTERVAL_MS = 3_000;
  const MIND_MAP_POLL_MAX_ATTEMPTS = 200;

  // Polls a single book's mind-map generation to completion, independent of
  // whether its screen is open. Guarded by mindMapInFlightRef so a reopened
  // screen (or a resume-check tick) can't start a second overlapping loop for
  // the same book. Always persists the resolved status; only pushes the result
  // onto the on-screen state if that exact book's screen is still the one open.
  async function pollMindMapUntilDone(bookId: string, cloudBookId: string) {
    if (mindMapInFlightRef.current.has(bookId)) {
      return;
    }
    mindMapInFlightRef.current.add(bookId);
    try {
      let attempts = 0;
      while (attempts < MIND_MAP_POLL_MAX_ATTEMPTS) {
        await new Promise<void>((resolve) => setTimeout(resolve, MIND_MAP_POLL_INTERVAL_MS));
        attempts++;

        const token = await getAccessToken();
        if (!token) {
          continue;
        }

        let result;
        try {
          result = await getMindMap(apiBaseUrl, cloudBookId, token);
        } catch {
          continue;
        }

        if (result.status === 'generating' || result.status === 'pending') {
          continue;
        }

        const resolvedStatus: 'ready' | 'failed' = result.status === 'ready' ? 'ready' : 'failed';
        const isBeingWatched = mindMapOpenRef.current && mindMapBookIdRef.current === bookId;

        setLibraryItems((items) =>
          items.map((item) =>
            item.id === bookId
              ? {
                  ...item,
                  mindMapJob: { status: resolvedStatus },
                  pendingNotice: isBeingWatched
                    ? item.pendingNotice
                    : { kind: 'mindmap', status: resolvedStatus, notifiedAt: new Date().toISOString() },
                }
              : item,
          ),
        );

        if (isBeingWatched) {
          setMindMapStatus(result.status);
          setMindMapData(result.data ?? null);
          setMindMapError(result.error);
        }
        return;
      }

      // Exceeded the cap — give up gracefully, matching indexBook.ts's own
      // pollUntilDone philosophy, rather than polling forever.
      setLibraryItems((items) =>
        items.map((item) => (item.id === bookId ? { ...item, mindMapJob: { status: 'failed' } } : item)),
      );
    } finally {
      mindMapInFlightRef.current.delete(bookId);
    }
  }

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

    const cloudBookId = resolveMindMapBookId(bookId, libraryItem.wholeBookAi);
    const isThisScreenActive = () => mindMapOpenRef.current && mindMapBookIdRef.current === bookId;

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

    try {
      const token = await getAccessToken();

      if (!token) {
        setMindMapOpen(false);
        setIsSignInOpen(true);
        return;
      }

      // Check current status
      const current = await getMindMap(apiBaseUrl, cloudBookId, token);

      if (!shouldStartMindMapGeneration(current.status, options.forceGenerate ?? false)) {
        if (isThisScreenActive()) {
          setMindMapStatus(current.status);
          setMindMapData(current.data ?? null);
          setMindMapError(current.error);
        }
        return;
      }

      // Not ready — trigger generation
      await generateMindMap(apiBaseUrl, cloudBookId, token);

      if (isThisScreenActive()) {
        setMindMapStatus('generating');
      }
      setLibraryItems((items) =>
        items.map((item) =>
          item.id === bookId ? { ...item, mindMapJob: { status: 'generating' } } : item,
        ),
      );

      void pollMindMapUntilDone(bookId, cloudBookId);
    } catch (err) {
      if (isThisScreenActive()) {
        setMindMapStatus('failed');
        setMindMapError(err instanceof Error ? err.message : 'Failed to load mind map');
      }
    }
  }

  function closeMindMap() {
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx jest`
Expected: PASS — all existing suites unaffected (no dedicated test file covers this `App.tsx` logic; this run is a regression check).

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "feat(mindmap): poll generation to completion independent of the screen"
```

---

### Task 2: Delegate `checkBackgroundJobs`' mind-map branch to `pollMindMapUntilDone`

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `pollMindMapUntilDone(bookId, cloudBookId)` (Task 1).

- [ ] **Step 1: Replace the one-shot mind-map check with a delegated call**

Find this exact block inside `checkBackgroundJobs`:

```ts
      if (item.mindMapJob?.status === 'generating' && item.wholeBookAi.cloudBookId) {
        try {
          const result = await getMindMap(apiBaseUrl, item.wholeBookAi.cloudBookId, token);
          if (result.status !== 'generating' && result.status !== 'pending') {
            const resolvedStatus: 'ready' | 'failed' = result.status === 'ready' ? 'ready' : 'failed';
            const bookId = item.id;
            const isBeingWatched = mindMapOpenRef.current && mindMapBookIdRef.current === bookId;
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
```

Replace with:

```ts
      if (item.mindMapJob?.status === 'generating' && item.wholeBookAi.cloudBookId) {
        void pollMindMapUntilDone(item.id, item.wholeBookAi.cloudBookId);
      }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx jest`
Expected: PASS — no regressions.

- [ ] **Step 4: Manual verification**

`App.tsx` has no dedicated test file for this integration, so verify these scenarios by hand on a
simulator/device before considering this feature done (per the design doc's Testing section):

1. Start mind map generation, close the screen immediately, keep reading in-app without backgrounding.
   Confirm the banner appears once generation finishes, with no backgrounding required.
2. Start generation for two different books, close both screens, keep reading. Confirm both eventually
   produce their own notice, oldest first.
3. Reopen the same book's mind map while it's still generating. Confirm it immediately shows the
   "generating" spinner and eventually shows the finished result once resolved, with no visible
   duplicate-polling glitch or error.
4. Confirm indexing behavior is unaffected — enable Whole-Book AI for a book and confirm the existing
   indexing flow (progress, completion, banner) still works exactly as before.
5. Force-quit the app while a mind map is generating, relaunch after it's likely finished server-side.
   Confirm it resumes being tracked live (via the resume-check's delegated call) and the banner appears
   without you reopening the mind map screen.

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "feat(mindmap): resume background jobs into a live poll, not a one-shot check"
```

---

## Manual verification (recap)

Covered in Task 2, Step 4 above — this is the final task in the plan.
