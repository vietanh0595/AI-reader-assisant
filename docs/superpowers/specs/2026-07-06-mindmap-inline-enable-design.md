# Inline enable + auto-generate for mind map

## Problem

Tapping the mind map for a book that hasn't finished Whole-Book AI indexing hits a
dead end. `openMindMap()` decides whether the book is "enabled" by checking
`!cloudBookId` alone. But `cloudBookId` is only merged into local state once the
entire indexing pipeline (upload → commit → poll) resolves — so this check reads
as "not enabled" for four different situations: never enabled, currently uploading,
currently indexing, and previously failed. All four currently render the same
static "Generation failed" screen with the message "Upload this book for
Whole-Book AI before generating a mind map." and a Retry button that calls
`generateMindMap` again against a `cloudBookId` that still doesn't exist — it can
never succeed.

Two other entry points in the same file already handle this correctly:
`openConversationThread()` and the mind map's own "Ask about this node" handler
both check `wholeBookAi.status !== 'ready'` and open the existing
`WholeBookAiSheet` (the same enable/progress/retry UI used for the Ask flow).
`openMindMap()` should behave the same way, plus continue straight into mind map
generation once enabling finishes — no reason to make the user tap twice when
they specifically asked for the mind map.

This is scoped narrowly to the mind map's enable path. A related, larger project —
notifying the user when indexing or mind map generation finishes while they've
navigated away, backgrounded, or fully closed the app — is being designed
separately.

## Behavior

### Trigger fix

Replace `openMindMap`'s `!cloudBookId` check with
`libraryItem.wholeBookAi.status !== 'ready'`, matching the other two call sites.
This now correctly covers all four non-ready states (`not_enabled`, `uploading`,
`queued`/`indexing`, `failed`) with one condition, instead of only catching the
`not_enabled` case.

### Redirect to the enable sheet

When that check is true:

1. If the target book isn't already the active book (mind map can be launched
   from the library list), make it active first — `openLibraryItem(bookId)` —
   matching the existing precedent in the mind map's `onAsk`/`onJumpToPassage`
   handlers.
2. Don't open the mind map screen. Instead open the existing `WholeBookAiSheet`
   (`setIsWholeBookAiOpen(true)`), which already renders the right view for every
   one of the four non-ready states: enable button, upload/indexing progress
   (with "you can close this" hint), or failed-with-retry.
3. Record the intent: `pendingMindMapAfterEnable: { bookId: string; bookTitle:
   string } | null`, set to `{ bookId, bookTitle }`. This mirrors the existing
   `pendingAuthenticatedAction` and `pendingQuickAsk` state/effect patterns
   already in `App.tsx`.

### Auto-continue once ready

A new effect watches `activeLibraryItem.wholeBookAi.status` together with
`pendingMindMapAfterEnable`:

- When `pendingMindMapAfterEnable !== null`, `activeLibraryItem.id ===
  pendingMindMapAfterEnable.bookId`, and `activeLibraryItem.wholeBookAi.status
  === 'ready'`:
  - Clear `pendingMindMapAfterEnable` (set to `null`).
  - Close the sheet (`setIsWholeBookAiOpen(false)`).
  - Call `openMindMap(bookId, bookTitle)` — no `forceGenerate` needed; a
    freshly-enabled book reports mind map status `pending`, which
    `shouldStartMindMapGeneration` already treats as "start generation."

This fires with no additional tap from the user — enabling directly continues
into mind map generation, since generating the mind map was the reason they
enabled it.

### Retry-after-failure still honors the pending intent

If indexing fails, the sheet's own Retry button (`onRetry={() => void
runIndexBook()}`) is untouched by this change. `pendingMindMapAfterEnable` stays
set through a failure, so retrying and eventually succeeding still auto-continues
into the mind map. Only an explicit close cancels the intent (below).

### Closing the sheet cancels the intent

`WholeBookAiSheet`'s `onClose` (wired to both the ✕ button and the backdrop tap)
now also clears `pendingMindMapAfterEnable`. This prevents a surprising later
jump: if the user closes the sheet without finishing, then separately enables
Whole-Book AI through a different entry point (e.g. the Ask flow) at some later
point, that success should not silently pull them into a mind map they no longer
asked for.

### No changes needed to

- `WholeBookAiSheet` — its existing states already cover every case this fix
  routes through.
- `resolveMindMapBookId` / `shouldStartMindMapGeneration` — unchanged; the fix is
  purely about which local condition decides whether to show the sheet.

## Testing

`App.tsx` has no dedicated test file today — this flow is currently verified by
hand only, and the pending-intent effect is a few lines tightly coupled to
existing `App.tsx` state, not a good candidate for extraction into an
independently-testable unit on its own. Verification for this change is manual:

1. Book never enabled → tap mind map → sheet opens showing "Enable whole-book
   AI" → tap enable → indexing progress shows in the sheet → once ready, sheet
   closes and mind map generation starts automatically.
2. Book mid-indexing (enabled via Ask flow earlier, sheet was closed) → tap mind
   map → sheet opens showing indexing progress (not the old dead-end message) →
   once ready, same auto-continue as above.
3. Book with a previously failed indexing attempt → tap mind map → sheet opens
   showing the failure and Retry → tap Retry → once ready, same auto-continue.
4. Book never enabled → tap mind map → sheet opens → close the sheet (✕ or
   backdrop) before enabling → confirm no mind map opens. Then separately enable
   Whole-Book AI via the Ask flow → confirm the mind map does *not* auto-open
   (the abandoned intent was cleared).
5. Typecheck (`npx tsc --noEmit`) and full test suite (`npx jest`) pass with no
   regressions, since no existing tests touch this code path.
