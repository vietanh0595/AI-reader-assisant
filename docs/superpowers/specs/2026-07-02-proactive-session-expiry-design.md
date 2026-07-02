# Proactive session-expiry notice — design

Date: 2026-07-02
Branch: feature/book-mindmap

## Problem

Session validity is only ever checked reactively: `getAccessToken()` (in
`src/auth/AuthProvider.tsx`) is called at the moment a gated action runs (Ask
the book, Import, Scan, Index). If the stored session can't be refreshed, the
`SignInSheet` pops up right then — interrupting whatever the user was trying
to do. After a long absence or an app rebuild that clears secure storage, this
means the first thing a returning user learns is "you're signed out," in the
middle of an action they actually wanted to complete.

There is no check on app launch or foreground; the session is read from
`expo-secure-store` once on mount and trusted until something tries to use it.

## Decided behavior

- The app proactively checks session validity on cold launch and every time it
  returns to the foreground (`AppState` → `active`), instead of waiting for a
  gated action.
- If the check finds the session can't be refreshed, a **non-blocking,
  dismissible banner** appears, inviting sign-in. It never blocks reading or
  any ungated feature — this app's core interaction stays sign-in-optional.
- The banner **only appears for users who have previously signed in on this
  device**, never for guests who haven't. A device-local flag,
  `hasEverSignedIn`, distinguishes the two. This keeps the fix scoped to "your
  existing session lapsed" and avoids nagging guests toward sign-up — that is
  a separate, out-of-scope growth question.
- Dismissing the banner suppresses it until either (a) the user hits the
  existing reactive prompt by trying a gated action, or (b) the app is fully
  relaunched. It does not reappear on every subsequent foreground within the
  same app session. If the user signs in again and a *future* expiry occurs,
  the banner is allowed to reappear (dismissal is not permanent across
  sign-in cycles).

## Data flow

```
AuthProvider (mount)          → restore session from SecureStore (unchanged)
AuthProvider (mount, post-restore)
  + AppState → 'active'       → if session present: getAccessToken() (no force)
                                 (existing refresh-or-expire logic, now triggered
                                 proactively instead of only at action time)
signIn() success              → persist hasEverSignedIn = true (new SecureStore key)
AuthContextValue              → + sessionExpired: boolean
                                 + dismissSessionExpiredNotice(): void
App.tsx                       → renders <SessionExpiredBanner /> near the top
                                 of the tree, wired to sessionExpired /
                                 dismissSessionExpiredNotice from useAuth()
```

`sessionExpired` is derived inside `AuthProvider` as
`hasEverSignedIn && !isAuthenticated && !isLoading`.

## Component details

### `src/auth/tokenStore.ts`

Add a second SecureStore key, `ai-reader-has-signed-in`, alongside the
existing `ai-reader-auth-session`:

```ts
export async function readHasEverSignedIn(): Promise<boolean>
export async function writeHasEverSignedIn(): Promise<void>
```

Stored as a plain non-sensitive marker (no need for a boolean-parsing schema
like the session object). Never deleted by `clearAuthSession()` — it lives
independently and is only ever set, never cleared, by app code. (A user could
still remove it by deleting the app / clearing device storage, which is an
acceptable, safe failure mode — see Edge cases.)

### `src/auth/AuthProvider.tsx`

- On mount, alongside the existing session restore, also read
  `hasEverSignedIn` into state.
- In `signIn()`, after `updateSession(nextSession)` succeeds, call
  `writeHasEverSignedIn()` and set local `hasEverSignedIn` state to `true`
  (idempotent if already true).
- Add an `AppState` subscription (`react-native`'s `AppState.addEventListener`)
  that, on transition to `active`, calls `getAccessToken()` if
  `sessionRef.current` is non-null. Also run the same check once immediately
  after the initial restore effect finishes (covers cold launch). No new
  refresh logic is needed — `getAccessToken()` already contains the
  freshness-check → refresh → `expireSession()`-on-failure chain
  (`AuthProvider.tsx:143-212`); this only changes *when* it's invoked.
- Add internal `dismissed` state (`useState(false)`), exposed as
  `dismissSessionExpiredNotice()` that sets it `true`. Reset `dismissed` back
  to `false` whenever `isAuthenticated` transitions from `false` to `true`
  (i.e., inside `updateSession` when moving from a null to non-null session),
  so a subsequent expiry after a fresh sign-in isn't permanently suppressed.
- Expose on `AuthContextValue`:
  ```ts
  sessionExpired: boolean; // hasEverSignedIn && !isAuthenticated && !isLoading
  dismissSessionExpiredNotice(): void;
  ```
- `UnconfiguredAuthProvider` (used when OIDC isn't configured for the build)
  gets the same two fields, both effectively inert (`sessionExpired: false`,
  no-op dismiss), matching its existing all-disabled shape.

### New component — `src/components/SessionExpiredBanner.tsx`

- Props: none required beyond what it reads from `useAuth()` directly
  (`sessionExpired`, `dismissSessionExpiredNotice`), plus an `onSignIn: () =>
  void` callback supplied by `App.tsx` to open the existing `SignInSheet`.
- Renders `null` when `!sessionExpired`.
- Otherwise renders a top-of-screen, non-blocking banner (does not use a
  modal/backdrop — sits above content, doesn't intercept touches elsewhere):
  - Text: "Your sign-in has expired. Sign in again to ask questions and sync
    your library."
  - "Sign in" button → calls `onSignIn()`.
  - Dismiss (×) button → calls `dismissSessionExpiredNotice()`.

### `App.tsx`

- Render `<SessionExpiredBanner onSignIn={() => setIsSignInOpen(true)} />`
  near the top of the component tree, reusing the same `SignInSheet` instance
  and open-state already used by the reactive flow (`App.tsx:3824-3843`). No
  new sign-in UI.

## Edge cases

- **Guest, never signed in:** `hasEverSignedIn` stays `false` forever until a
  first successful sign-in → `sessionExpired` is always `false` → banner never
  renders. Matches "don't nag guests."
- **Storage wiped (app rebuild / reinstall):** both the session and
  `hasEverSignedIn` live in the same SecureStore item space; if wiped, the
  device reverts to looking like a fresh guest. Safe failure mode — the worst
  outcome is one missed reminder, not a false nag.
- **Rapid background/foreground flicker:** harmless. `getAccessToken()`
  already no-ops via `AuthSession.TokenResponse.isTokenFresh()` when the
  cached token is still valid, so most foreground checks do nothing.
- **Existing reactive flow (tap Ask/Import/Scan/Index while expired):**
  unchanged. Still opens `SignInSheet` directly regardless of banner/dismiss
  state.
- **Revoked-but-locally-fresh token surfacing as a plain error in
  `bookAskApi.ts`:** out of scope for this design — noted as a pre-existing,
  separate inconsistency (no 401 retry there, unlike `src/api/client.ts`).

## Testing

- `AuthProvider` unit tests:
  - `hasEverSignedIn` is written on first successful `signIn()` and survives
    `signOut()` and `expireSession()`.
  - `sessionExpired` is `true` only when `hasEverSignedIn && !isAuthenticated
    && !isLoading`; `false` in all other combinations.
  - `AppState` change to `active` triggers `getAccessToken()` when a session
    is present; no call when there is no session.
  - `dismissSessionExpiredNotice()` sets `sessionExpired`-consuming `dismissed`
    state; a subsequent `false → true` `isAuthenticated` transition resets
    `dismissed` back to `false`.
- `SessionExpiredBanner` component tests:
  - Renders nothing when `sessionExpired` is `false`.
  - Renders the banner and responds to "Sign in" (`onSignIn` called) and
    dismiss (`dismissSessionExpiredNotice` called) when `sessionExpired` is
    `true`.
- Manual/device check: sign in, background the app, invalidate/expire the
  refresh token (or wait past expiry), foreground the app, confirm the banner
  appears without touching any gated feature; confirm dismiss hides it for the
  rest of that app session; confirm a fresh relaunch re-shows it if still
  expired.

## Out of scope

- Guest → sign-up growth prompts (separate initiative; different cadence/copy
  concerns).
- Fixing the missing 401-retry logic in `bookAskApi.ts`.
- Any change to the existing reactive sign-in prompts on Import/Scan/Index/Ask.
- Cross-device sign-in-state tracking (the `hasEverSignedIn` flag is strictly
  per-device, local storage only).
