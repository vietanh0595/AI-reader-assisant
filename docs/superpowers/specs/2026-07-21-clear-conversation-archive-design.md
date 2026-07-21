# Archive (not delete) on "Clear conversation"

## Problem

Each book has one Ask thread (`LibraryItem.conversation`, `src/library/conversation.ts`), and the
existing "Clear" button in `ConversationThread.tsx` (`onClear` → `clearConversation()` in `App.tsx`)
instantly and permanently discards it: `conversation: []`, no confirmation, no way to recover it. This
serves two real needs — "old chapter turns muddying a later vague follow-up" (history-bleed) and "this
thread got messy, I want to start fresh" — but destroys data for no necessary reason. The release plan
(`Book Reading App - Release Plan.md`, Feature improvements) already decided this should be non-destructive
and lightweight: "tiny schema change, no thread-list UI, no auto-titling, no extra AI calls."

The value of not deleting is groundwork for a separate, already-backlogged idea — real note/conversation
export (Markdown/PDF) — rather than anything the user can access today. There is deliberately no browsing
UI for the archive in this iteration.

## Design

### Data model

Add one optional field to `LibraryItem` (in `App.tsx`, where `LibraryItem` is defined):

```ts
archivedConversations?: ConversationTurn[][];
```

An array of past conversation snapshots — one entry per clear, appended, never overwritten, so multiple
clears over a book's lifetime don't silently lose earlier archives. This is additive and optional, so it
follows the same precedent already used for `mindMapJob`/`pendingNotice` earlier in this codebase: no
`LIBRARY_SCHEMA_VERSION` bump, and no new persistence code needed since `LibraryItem` already serializes
wholesale via the existing `writePersistedReaderState`/`readPersistedReaderState` flow.

`migrateLibraryItem` in `src/library/conversation.ts` normalizes it the same way it already normalizes
`conversation`:

```ts
export function migrateLibraryItem<T extends { schemaVersion?: number; conversation?: ConversationTurn[]; archivedConversations?: ConversationTurn[][] }>(
  item: T,
): T & { schemaVersion: number; conversation: ConversationTurn[]; archivedConversations: ConversationTurn[][] } {
  return {
    ...item,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    conversation: item.conversation ?? [],
    archivedConversations: item.archivedConversations ?? [],
  };
}
```

### Clearing behavior

`clearConversation()` in `App.tsx` changes from an instant hard-delete to:

1. If `activeLibraryItem.conversation.length === 0`, do nothing — nothing to confirm, nothing to clear.
2. Otherwise, show a native confirmation (`Alert.alert` from `react-native`, already available — no new
   dependency, no new themed component needed for what the release plan explicitly calls a lightweight
   fix):
   - Title: `"Clear conversation?"`
   - Message: `"This book's current questions and answers will be cleared. You'll start fresh."`
   - Buttons: `Cancel` (style `cancel`), `Clear` (style `destructive`).
3. On confirming `Clear`: push the current `conversation` array onto `archivedConversations`, then reset
   `conversation` to `[]`, in one `updateActiveLibraryItem` call.

The confirmation copy deliberately does not mention "archive" or promise recoverability — there is no UI
to view or restore the archive yet, so telling the user their data is "archived" would overstate what
they can actually do today. The archive is honest internal groundwork for a future export feature, not a
user-facing capability in this iteration.

### Explicitly out of scope

No thread-list UI, no way to view or restore an archived conversation, no auto-titling, no extra AI
calls, no change to `src/rag/buildHistory.ts` (it already only ever reads the active `conversation`
array, so archiving previous conversations doesn't affect what history is sent to the model).

## Testing

- `src/library/conversation.test.ts`: new test case asserting `migrateLibraryItem` defaults
  `archivedConversations` to `[]` when missing, and leaves an existing `archivedConversations` array
  untouched — mirroring the two existing tests for `conversation`'s own normalization.
- `App.tsx`'s `clearConversation()` and its `Alert.alert` wiring have no dedicated test file, consistent
  with the rest of this app's `App.tsx` changes — verified via typecheck, full-suite regression, and
  manual on-device verification:
  1. Ask a question, tap "Clear," confirm the native dialog appears with the expected copy.
  2. Tap "Cancel" — confirm the conversation is untouched.
  3. Tap "Clear" — confirm the thread empties and a fresh conversation can be started.
  4. Tap "Clear" again on an empty (freshly cleared) thread — confirm no dialog appears (nothing to
     clear) and nothing breaks.
  5. Clear a thread twice with different content in between — confirm (by inspecting persisted state,
     since there's no UI) that both archived snapshots are retained, not just the most recent.
