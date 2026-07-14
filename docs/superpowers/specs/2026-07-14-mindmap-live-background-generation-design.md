# Mind map generation independent of screen

## Problem

Indexing (enabling Whole-Book AI) keeps running to completion regardless of what screen the user is
looking at — its async chain isn't tied to any UI, so the background-job-notice feature's live path
(set in `runIndexBookFor`) fires correctly the moment it resolves, whether or not the user is still
watching. Mind map generation does not have this property: `closeMindMap()` deliberately cancels its
poll (`mindMapCancelRef.current = true` + clearing `mindMapPollRef`'s interval) the instant the screen
closes. This was intentional in the original mind-map feature, but it means mind map completions are
only ever discovered by the launch/foreground resume-check — never while the user is still actively
using the app, just not looking at that screen. Manual testing of the background-job-notice feature
surfaced this gap directly (Scenario 3 in that feature's design doc was explicitly scoped around it).

This also surfaced two related bugs, fixed separately and already shipped (commit `e5f713f`, not part of
this spec):
- The resume-check effect fired once auth finished loading, before the real persisted library state
  (which could include an in-flight indexing/mind-map job) had actually loaded from disk — so a
  relaunch after a force-quit could silently skip resuming anything.
- The mind map's "generating" screen had no copy indicating the process continues in the background —
  now has a reassurance line matching `WholeBookAiSheet`'s existing pattern.

This spec covers making mind map generation behave like indexing: continue polling to completion
independent of the screen, so the background-job-notice banner can catch a completion the moment it
happens, not just on the next foreground/relaunch.

## Design

### Replace the single screen-owned poll with a per-book, screen-independent one

Today, `mindMapPollRef: useRef<Timer | null>` and `mindMapCancelRef: useRef<boolean>` are singletons —
correct only because closing the screen always killed whatever was running. To let generation survive
close, and let multiple books generate concurrently (mirroring indexing, where several books can index
at once with no interference), these are replaced with the same pattern indexing already uses:

- **Remove:** `mindMapPollRef`, `mindMapCancelRef`, and the `cancelled()`/`cancelled` closure built from
  them.
- **Add:** `mindMapInFlightRef = useRef<Set<string>>(new Set())` — same shape as the existing
  `inFlightIndexingRef`, keyed by book id, preventing two overlapping poll loops for the same book.
- **New function `pollMindMapUntilDone(bookId: string, cloudBookId: string): Promise<void>`** — a
  self-contained async loop (not a `setInterval`), modeled on `src/rag/indexBook.ts`'s existing
  `pollUntilDone`: sleeps 3 seconds, checks status via `getMindMap`, repeats until terminal or a cap of
  200 attempts (~10 minutes, matching indexing's own `_POLL_MAX_ATTEMPTS`/`_POLL_INTERVAL_MS`), then
  gives up gracefully (marks the job `failed`) rather than polling forever. Guarded at entry by
  `mindMapInFlightRef` (no-ops if a loop is already running for that book), and once started, keeps
  running to completion regardless of what's on screen.

```ts
const MIND_MAP_POLL_INTERVAL_MS = 3_000;
const MIND_MAP_POLL_MAX_ATTEMPTS = 200;

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
        continue; // transient/expired token — try again next tick, don't abandon tracking
      }

      let result;
      try {
        result = await getMindMap(apiBaseUrl, cloudBookId, token);
      } catch {
        continue; // network hiccup — try again next tick
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

    // Exceeded the cap — give up gracefully, matching indexBook.ts's own philosophy.
    setLibraryItems((items) =>
      items.map((item) => (item.id === bookId ? { ...item, mindMapJob: { status: 'failed' } } : item)),
    );
  } finally {
    mindMapInFlightRef.current.delete(bookId);
  }
}
```

This is illustrative of the shape, not final production code — the plan will pin down exact code
against the real file, and reuse the existing `mindMapOpenRef`/`mindMapBookIdRef` refs (already added by
the background-job-notice feature's Task 4) rather than redeclaring them.

### `openMindMap`: persisted writes stay unconditional; screen writes gate on "is this book's screen still active"

Same split as indexing already applies in `runIndexBookFor`. Define a local
`isThisScreenActive = () => mindMapOpenRef.current && mindMapBookIdRef.current === bookId;` closure
(mirroring `runIndexBookFor`'s existing `isBeingWatched()` naming), and apply it to every screen-only
state write in the pre-poll sequence (the current-status check's `setMindMapStatus`/`setMindMapData`/
`setMindMapError`, the `setMindMapStatus('generating')` right before starting to poll, and the outer
catch block's failure display) — none of these should fire if the user has since closed the screen or
switched to a different book's map, exactly the same reasoning as `isBeingWatched()` guards indexing's
resolution writes.

The one persisted write in this section — `mindMapJob: { status: 'generating' }`, set right after
`generateMindMap()` succeeds — stays unconditional, matching indexing's `wholeBookAi.status = 'uploading'`
write, which also always applies regardless of what's on screen.

Replace the old inline `setInterval` block entirely with a single call:
`void pollMindMapUntilDone(bookId, cloudBookId);`

The `if (!token) { setMindMapOpen(false); setIsSignInOpen(true); return; }` branch is unchanged —
`openMindMap` is always reached via a user-facing navigation action (tapping the mind map entry point,
the auto-continue-after-enabling effect, or the background-job banner's "View"), so popping the sign-in
sheet here remains correct and expected.

### `checkBackgroundJobs`: delegate directly to `pollMindMapUntilDone`

The mind-map branch currently does its own one-shot `getMindMap` check and inline write. Replace it with
a direct call: `void pollMindMapUntilDone(item.id, item.wholeBookAi.cloudBookId);` for any book with
`mindMapJob?.status === 'generating'`. This mirrors the existing relationship between
`checkBackgroundJobs` and `runIndexBookFor` for indexing — the resume-check just kicks off the
appropriate function and lets it decide what to do; `pollMindMapUntilDone`'s own in-flight guard already
prevents a duplicate loop if one happens to already be running. A side benefit: a mind map still
`'generating'` after the app was fully killed now gets picked back up *live* on relaunch (the resume
call starts a real polling loop), rather than only re-checked once and left to wait for the next
foreground event.

### `closeMindMap`: drop cancellation

Remove the `mindMapCancelRef.current = true` and the `clearInterval`/`mindMapPollRef` clearing entirely.
Closing the screen now only snapshots live nav/selection state and hides the screen
(`setMindMapOpen(false)`) — it no longer affects whether generation keeps being tracked.

## Testing

`App.tsx` has no dedicated test file (consistent with the rest of the background-job-notice feature) —
verification is typecheck + full existing suite (regression-only, since this doesn't touch
`src/rag/mindmapTarget.ts`, `src/rag/mindmapApi.ts`, or any other file with its own tests) + manual
on-device verification:

1. Start mind map generation, close the screen immediately, keep reading in-app without backgrounding.
   Confirm the banner appears once generation finishes, with no backgrounding required — this is the
   direct test of the feature this spec adds.
2. Start generation for two different books, close both screens, keep reading. Confirm both eventually
   produce their own notice, oldest first (reusing the existing single-slot banner ordering).
3. Reopen the same book's mind map while it's still generating. Confirm it immediately shows the
   "generating" spinner (via the pre-poll status check, unaffected by this change) and eventually shows
   the finished result once the in-flight loop resolves, with no visible duplicate-polling glitch or
   error.
4. Confirm indexing behavior is unaffected — this change touches no indexing code path.
