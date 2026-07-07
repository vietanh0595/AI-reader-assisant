# Background job completion banner

## Problem

Indexing (enabling Whole-Book AI) and mind map generation are both long-running,
asynchronous processes with no signal to the user when they finish unless the
user happens to already be looking at the relevant sheet/screen. Two distinct
gaps:

1. **Same-session, navigated away.** The user closes the enable sheet or the
   mind map screen and goes on reading elsewhere in the app. Indexing keeps
   running regardless (its async chain isn't tied to any screen), but nothing
   tells the user it finished. Mind map generation's client-side polling is
   tied to the screen and stops the moment it's closed — so, unlike indexing,
   nothing continues checking on it at all in this case.
2. **App backgrounded or fully closed.** Indexing's in-flight async chain is
   suspended or killed along with the JS runtime; on relaunch nothing resumes
   checking it. Mind map generation state isn't persisted at all today, so a
   killed app loses all memory that a generation was ever in flight.

This is a companion project to
[Inline enable + auto-generate for mind map](2026-07-06-mindmap-inline-enable-design.md),
designed separately per that spec's note about decomposition.

**Explicitly out of scope for this iteration:** OS-level push notifications
(i.e. a notification that reaches the user while the app is fully backgrounded
or closed, with no foreground/relaunch involved). This is a likely future need
once there's real usage data on how often people background mid-job — it
requires `expo-notifications`, a permission prompt, device-token registration,
and a backend hook to fire on job completion. In-app coverage (below) is the
whole of this iteration's scope.

## Behavior

### Detection mechanism: one-shot checks anchored to real app-open moments

No continuously-running background timer. Instead, this reuses the same
`AppState`-driven pattern already built for the proactive session-expiry
check (`src/auth/AuthProvider.tsx`): a new effect in `App.tsx` fires once when
the app finishes its initial load, and again every time `AppState` transitions
to `'active'`. On each fire, it scans every `LibraryItem` for unresolved
work and makes exactly one status-check network call per unresolved item —
never a running poll.

### Data model additions (`LibraryItem`, in `App.tsx`)

```ts
type LibraryItem = {
  // ...existing fields unchanged...
  mindMapJob?: { status: 'generating' | 'ready' | 'failed' };
  pendingNotice?: {
    kind: 'indexing' | 'mindmap';
    status: 'ready' | 'failed';
    notifiedAt: string; // ISO timestamp
  };
};
```

Both fields are optional, so no `LIBRARY_SCHEMA_VERSION` bump or migration is
needed — same as `WholeBookAiState.cloudBookId` already being optional and
handled with no migration.

- `mindMapJob` is new because mind map generation status isn't tracked
  per-book anywhere today (only as transient state on whichever mind map
  screen happens to be open). It gives mind map generation a durable home so
  a killed app can pick the check back up, mirroring what `wholeBookAi`
  already does for indexing.
- `pendingNotice` is the single flag the banner renders from — "there's an
  unseen completion for this book." `notifiedAt` exists purely to pick a
  deterministic order if more than one book has an unseen notice at once.

### Indexing: two paths set `pendingNotice`

**Live path (same session):** at `runIndexBook`'s two existing resolution
points (the success merge and the catch block), check whether the user is
currently watching *this specific* book's sheet:
`isWholeBookAiOpenRef.current && activeBookIdRef.current === activeId`. Reading
via refs (not the closed-over `isWholeBookAiOpen`/`activeBookId` values from
when the function was first called) matters because the async chain can
resolve long after the user has navigated elsewhere — same reasoning already
applied to `sessionRef` in `AuthProvider.tsx`. If not watching, set
`pendingNotice = { kind: 'indexing', status, notifiedAt: new Date().toISOString() }`
on that book. If watching, do nothing — the sheet already shows the result
live.

**Resume path (app was killed mid-index):** `cloudBookId` isn't set locally
until the whole `indexBook()` pipeline resolves, so a killed app has no
lightweight "just check status" call available for a book still mid-upload —
resuming means re-running the same logic `runIndexBook()` already uses.
`indexBook()`'s own resume mechanism (`api.createOrResume`, keyed by
`contentHash` + `clientBookId`, not a remembered server id) already handles
"pick up wherever the server left off" — that part needs no new logic.

What's missing is that `runIndexBook()` today only ever operates on
`activeLibraryItem`/`currentBook` (whatever's open in the reader). Generalize
it:

```ts
async function runIndexBookFor(libraryItem: LibraryItem): Promise<void> {
  // existing runIndexBook() body, with every reference to
  // activeLibraryItem/currentBook replaced by the libraryItem parameter,
  // and activeId replaced by libraryItem.id
}

async function runIndexBook(): Promise<void> {
  return runIndexBookFor(activeLibraryItem);
}
```

The existing Enable/Retry buttons keep calling `runIndexBook()` — unchanged
behavior. The new resume-check effect (below) calls `runIndexBookFor(item)` for
any library item whose `wholeBookAi.status` is `uploading`, `queued`, or
`indexing` — regardless of whether that book is the one currently open.

### Mind map: one path sets `pendingNotice`

Simpler than indexing: because closing the mind map screen already cancels its
poll (existing, unchanged behavior — `closeMindMap()` clears
`mindMapPollRef` and sets `mindMapCancelRef.current = true`), there is no live
in-app path to handle. `pendingNotice` for mind maps is set *only* by the
resume-check effect.

When `openMindMap()` successfully calls `generateMindMap()` and starts polling,
it also sets `libraryItem.mindMapJob = { status: 'generating' }` at that same
moment (new — this is what lets the resume-check discover it later).

### The resume-check effect (new, in `App.tsx`)

```ts
// Mirrors libraryItems so checkBackgroundJobs always reads the current list
// without needing libraryItems in the effect's dependency array below — that
// would tear down and re-subscribe the AppState listener on every progress
// update, which fires far too often to be the right trigger for resubscribing.
const libraryItemsRef = useRef(libraryItems);
libraryItemsRef.current = libraryItems;

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

async function checkBackgroundJobs() {
  const token = await getAccessToken();
  if (!token) {
    return;
  }
  for (const item of libraryItemsRef.current) {
    if (['uploading', 'queued', 'indexing'].includes(item.wholeBookAi.status)) {
      void runIndexBookFor(item);
    }
    if (item.mindMapJob?.status === 'generating' && item.wholeBookAi.cloudBookId) {
      const result = await getMindMap(apiBaseUrl, item.wholeBookAi.cloudBookId, token);
      if (result.status === 'ready' || result.status === 'failed') {
        const isBeingWatched = mindMapOpen && mindMapBookId === item.id;
        setLibraryItems((items) =>
          items.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  mindMapJob: { status: result.status },
                  pendingNotice: isBeingWatched
                    ? i.pendingNotice
                    : { kind: 'mindmap', status: result.status, notifiedAt: new Date().toISOString() },
                }
              : i,
          ),
        );
      }
    }
  }
}
```

This is illustrative of the shape, not final production code — the plan will
pin down exact variable names and control flow against the real file. Key
points it must preserve: one status call per unresolved item per
launch/foreground tick (no continuous polling), and no `pendingNotice` set for
whichever book's screen is currently open and already showing the result live.

### Selecting which notice to show: `src/rag/backgroundNotice.ts` (new file)

A small, pure, independently-testable function — following the same pattern
as `resolveMindMapBookId`/`shouldStartMindMapGeneration` in
`src/rag/mindmapTarget.ts`:

```ts
export type PendingNotice = {
  bookId: string;
  bookTitle: string;
  kind: 'indexing' | 'mindmap';
  status: 'ready' | 'failed';
};

export function selectPendingNotice(
  libraryItems: Array<{ id: string; book: { title: string }; pendingNotice?: { kind: 'indexing' | 'mindmap'; status: 'ready' | 'failed'; notifiedAt: string } }>,
): PendingNotice | null {
  const withNotice = libraryItems.filter((item) => item.pendingNotice);
  if (withNotice.length === 0) {
    return null;
  }
  const oldest = withNotice.reduce((earliest, item) =>
    item.pendingNotice!.notifiedAt < earliest.pendingNotice!.notifiedAt ? item : earliest,
  );
  return {
    bookId: oldest.id,
    bookTitle: oldest.book.title,
    kind: oldest.pendingNotice!.kind,
    status: oldest.pendingNotice!.status,
  };
}
```

### The banner: `src/components/BackgroundJobBanner.tsx` (new component)

Rendered at the app root in `App.tsx`, alongside `SessionExpiredBanner` and
the other global banners. `ReaderApp` computes
`selectPendingNotice(libraryItems)` each render and passes the result (or
`null`) down.

Copy:
- Ready: `"'{title}' is ready — View"`
- Failed: `"Indexing for '{title}' failed — View"` (kind: indexing) /
  `"Mind map for '{title}' failed — View"` (kind: mindmap)

Props: `{ notice: PendingNotice | null; onView: () => void; onDismiss: () => void }`.
Renders `null` when `notice` is `null` — same presentational-component pattern
as `SessionExpiredBanner`/`SignInSheet` (props only, no context access, so it's
testable in isolation).

**Tap "View":** switch to that book (`openLibraryItem(bookId)`), clear its
`pendingNotice`, and open the right destination:
- `kind: 'indexing'` → open the `WholeBookAiSheet` (`setIsWholeBookAiOpen(true)`)
  — it renders the already-resolved ready/failed state immediately.
- `kind: 'mindmap'` → call `openMindMap(bookId, bookTitle)` — the existing
  status check inside it will see `ready` and show the result immediately, no
  regeneration triggered.

**Dismiss (✕):** clear that book's `pendingNotice` only. No navigation.

**Multiple concurrent completions:** the banner is a single slot, not a
stack. `selectPendingNotice` always returns the oldest unseen notice. Clearing
one (via view or dismiss) causes the next render to naturally show the
next-oldest, if any — a FIFO shown one at a time through one banner, not a
literal queue data structure. Deliberately not batching into something like
"3 books are ready" for this iteration — no evidence yet that concurrent
completions are common enough to need it.

**Clearing notices organically:** if the user opens the relevant screen for a
book on their own — without ever tapping the banner — that view already
implies "not pendingNotice-worthy" by the same condition used to decide not to
show the banner in the first place (see "is currently watching" checks
above). Opening the sheet/screen and seeing the result live is itself the
"seen" signal; no separate marking step is needed. Concretely: opening
`WholeBookAiSheet` or `openMindMap` for a book with a `pendingNotice` should
clear that notice as part of the same action that opens it.

## Testing

- `src/rag/backgroundNotice.ts`: full TDD coverage — no notices (returns
  `null`), one notice, multiple notices (returns oldest by `notifiedAt`), a
  mix of books with and without notices.
- `src/components/BackgroundJobBanner.tsx`: TDD coverage matching the
  `SessionExpiredBanner.test.tsx` pattern — renders nothing when `notice` is
  `null`, shows ready copy and fires `onView`, shows failed copy, fires
  `onDismiss`.
- Everything else (the `runIndexBookFor` refactor, the resume-check effect,
  `mindMapJob` wiring, banner integration in `App.tsx`) has no test seams
  today, same as the rest of `App.tsx` — verified via typecheck + full
  existing suite (regression-only) + manual on-device scenarios:
  1. Enable Whole-Book AI, close the sheet immediately, keep reading in-app.
     Confirm the banner appears once indexing finishes (same session,
     no backgrounding).
  2. Start a mind map generating, close the mind map screen, keep reading
     in-app without backgrounding. Confirm the banner does **not** appear
     yet (expected — no live poller for mind maps by design). Background
     and re-foreground the app once generation has actually finished
     server-side. Confirm the banner now appears.
  3. Start indexing, force-quit the app mid-upload, relaunch. Confirm
     indexing resumes automatically (no need to reopen the sheet) and the
     banner appears once it finishes.
  4. Start a mind map generating, force-quit the app, relaunch after it's
     finished server-side. Confirm the banner appears without reopening the
     mind map screen.
  5. Start two different books indexing/generating concurrently, background
     the app, wait for both to finish, foreground. Confirm the banner shows
     one at a time (oldest first) and advances to the second after
     dismissing/viewing the first.
  6. Tap "View" on a ready indexing notice — confirm it opens the sheet
     showing the ready state, not a fresh enable flow. Tap "View" on a ready
     mind map notice — confirm it shows the already-generated result, not a
     regeneration.
  7. As a guest who has never enabled anything: confirm the banner never
     appears (no notices are ever created if nothing was ever enabled).
