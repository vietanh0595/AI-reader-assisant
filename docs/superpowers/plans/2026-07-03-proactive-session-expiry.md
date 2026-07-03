# Proactive Session-Expiry Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect an expired sign-in session proactively (on launch and on returning to the foreground) and surface a dismissible, non-blocking banner instead of waiting for the user to hit a gated action (Ask/Import/Scan/Index) and be interrupted by the reactive `SignInSheet`.

**Architecture:** `AuthProvider` (`src/auth/AuthProvider.tsx`) gains a device-local `hasEverSignedIn` flag (persisted via a new `expo-secure-store` key), a derived `sessionExpired` boolean, and a dismiss action — all exposed through the existing `useAuth()` context. A `react-native` `AppState` listener triggers the existing `getAccessToken()` refresh-or-expire logic on launch and every foreground transition, instead of only at gated-action time. A new presentational component, `SessionExpiredBanner`, renders the reminder; `App.tsx` wires it up next to the existing `SignInSheet`.

**Tech Stack:** React Native / Expo / TypeScript, `expo-auth-session`, `expo-secure-store`, `react-native`'s `AppState`, Jest + `@testing-library/react-native`.

## Global Constraints

- The banner must never block reading or any ungated feature (spec: "non-blocking, dismissible banner").
- The banner must only ever appear for a device that has previously completed a real sign-in (`hasEverSignedIn === true`) — never for a guest who has not (spec: "only appear for users who have previously signed in on this device").
- Dismissing the banner suppresses it until either a gated action triggers the existing reactive prompt, or the app is fully relaunched — it must not reappear on every foreground within the same app session (spec: "Dismissing the banner suppresses it...").
- A dismissal must not be permanent across sign-in cycles: if the user signs in again and a later expiry occurs, the banner may reappear (spec: "the banner is allowed to reappear").
- `hasEverSignedIn` is strictly local, per-device storage — no server-side or cross-device tracking (spec: "Out of scope... Cross-device sign-in-state tracking").
- No changes to the existing reactive sign-in flow on Import/Scan/Index/Ask, and no changes to `bookAskApi.ts`'s 401 handling (spec: "Out of scope").
- Exact banner copy: `"Your sign-in has expired. Sign in again to ask questions and sync your library."`

---

## Task 1: Persist a device-local `hasEverSignedIn` flag

**Files:**
- Modify: `src/auth/tokenStore.ts`
- Test: `src/auth/tokenStore.test.ts`

**Interfaces:**
- Produces: `readHasEverSignedIn(): Promise<boolean>`, `writeHasEverSignedIn(): Promise<void>` — both used by `AuthProvider.tsx` in Task 2.

- [ ] **Step 1: Write the failing tests**

Add to `src/auth/tokenStore.test.ts`, inside the existing `describe('tokenStore', ...)` block (after the last `test(...)`, before the closing `});`). Also update the top-level import to include the two new functions:

```ts
import { clearAuthSession, readAuthSession, readHasEverSignedIn, writeAuthSession, writeHasEverSignedIn } from './tokenStore';
```

```ts
  test('reads hasEverSignedIn as false when it has never been written', async () => {
    secureStore.getItemAsync.mockResolvedValue(null);

    await expect(readHasEverSignedIn()).resolves.toBe(false);
    expect(secureStore.getItemAsync).toHaveBeenCalledWith('ai-reader-has-signed-in');
  });

  test('reads hasEverSignedIn as true once it has been written', async () => {
    secureStore.getItemAsync.mockResolvedValue('true');

    await expect(readHasEverSignedIn()).resolves.toBe(true);
  });

  test('writes hasEverSignedIn', async () => {
    await writeHasEverSignedIn();

    expect(secureStore.setItemAsync).toHaveBeenCalledWith('ai-reader-has-signed-in', 'true');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/auth/tokenStore.test.ts`
Expected: FAIL — `readHasEverSignedIn` / `writeHasEverSignedIn` are not exported from `./tokenStore`.

- [ ] **Step 3: Implement the minimal code**

In `src/auth/tokenStore.ts`, add a second key constant next to `AUTH_SESSION_KEY` and two new exported functions. Full resulting file:

```ts
import * as SecureStore from 'expo-secure-store';

import type { PersistedAuthSession } from './types';

const AUTH_SESSION_KEY = 'ai-reader-auth-session';
const HAS_SIGNED_IN_KEY = 'ai-reader-has-signed-in';

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isPersistedAuthSession(value: unknown): value is PersistedAuthSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    typeof candidate.issuedAt === 'number' &&
    Number.isFinite(candidate.issuedAt) &&
    (candidate.expiresIn === undefined ||
      (typeof candidate.expiresIn === 'number' &&
        Number.isFinite(candidate.expiresIn) &&
        candidate.expiresIn >= 0)) &&
    isOptionalString(candidate.idToken) &&
    isOptionalString(candidate.refreshToken) &&
    isOptionalString(candidate.scope) &&
    isOptionalString(candidate.state) &&
    // token_type is case-insensitive per RFC 6749; Auth0 returns "Bearer".
    (candidate.tokenType === undefined ||
      (typeof candidate.tokenType === 'string' &&
        ['bearer', 'mac'].includes(candidate.tokenType.toLowerCase())))
  );
}

function sanitizeSession(session: PersistedAuthSession): PersistedAuthSession {
  return {
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    idToken: session.idToken,
    issuedAt: session.issuedAt,
    refreshToken: session.refreshToken,
    scope: session.scope,
    state: session.state,
    tokenType: session.tokenType,
  };
}

export async function readAuthSession(): Promise<PersistedAuthSession | null> {
  const storedValue = await SecureStore.getItemAsync(AUTH_SESSION_KEY);
  if (storedValue === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (isPersistedAuthSession(parsed)) {
      return parsed;
    }
  } catch {
    // Invalid data is removed below.
  }

  await clearAuthSession();
  return null;
}

export async function writeAuthSession(session: PersistedAuthSession): Promise<void> {
  await SecureStore.setItemAsync(AUTH_SESSION_KEY, JSON.stringify(sanitizeSession(session)));
}

export async function clearAuthSession(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
}

export async function readHasEverSignedIn(): Promise<boolean> {
  const storedValue = await SecureStore.getItemAsync(HAS_SIGNED_IN_KEY);
  return storedValue === 'true';
}

export async function writeHasEverSignedIn(): Promise<void> {
  await SecureStore.setItemAsync(HAS_SIGNED_IN_KEY, 'true');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/auth/tokenStore.test.ts`
Expected: PASS — all tests including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/auth/tokenStore.ts src/auth/tokenStore.test.ts
git commit -m "feat(auth): persist a device-local hasEverSignedIn flag"
```

---

## Task 2: Track `hasEverSignedIn`, derive `sessionExpired`, support dismissal

**Files:**
- Modify: `src/auth/AuthProvider.tsx`
- Modify: `src/auth/types.ts`
- Test: `src/auth/AuthProvider.test.tsx`

**Interfaces:**
- Consumes: `readHasEverSignedIn()`, `writeHasEverSignedIn()` from Task 1.
- Produces: `AuthContextValue.sessionExpired: boolean`, `AuthContextValue.dismissSessionExpiredNotice(): void` — consumed by `SessionExpiredBanner` (Task 4) via `App.tsx` (Task 5).

- [ ] **Step 1: Write the failing tests**

In `src/auth/AuthProvider.test.tsx`:

1. Update the `jest.mock('./tokenStore', ...)` block and the destructured imports/`tokenStore` helper to include the two new functions:

```ts
jest.mock('./tokenStore', () => ({
  clearAuthSession: jest.fn(),
  readAuthSession: jest.fn(),
  readHasEverSignedIn: jest.fn(),
  writeAuthSession: jest.fn(),
  writeHasEverSignedIn: jest.fn(),
}));

const { AuthProvider, useAuth } = require('./AuthProvider') as typeof import('./AuthProvider');
const {
  clearAuthSession,
  readAuthSession,
  readHasEverSignedIn,
  writeAuthSession,
  writeHasEverSignedIn,
} = require('./tokenStore') as typeof import('./tokenStore');

const tokenStore = {
  clear: jest.mocked(clearAuthSession),
  read: jest.mocked(readAuthSession),
  readHasEverSignedIn: jest.mocked(readHasEverSignedIn),
  write: jest.mocked(writeAuthSession),
  writeHasEverSignedIn: jest.mocked(writeHasEverSignedIn),
};
```

2. Add default mock resolutions to `beforeEach`, alongside the existing three:

```ts
  beforeEach(() => {
    jest.clearAllMocks();
    setConfiguredEnvironment();
    mockMakeRedirectUri.mockReturnValue('aibookreader://');
    mockUseAutoDiscovery.mockReturnValue(discovery);
    mockUseAuthRequest.mockReturnValue([authRequest, null, mockPromptAsync]);
    tokenStore.read.mockResolvedValue(null);
    tokenStore.write.mockResolvedValue();
    tokenStore.clear.mockResolvedValue();
    tokenStore.readHasEverSignedIn.mockResolvedValue(false);
    tokenStore.writeHasEverSignedIn.mockResolvedValue();
    mockIsTokenFresh.mockReturnValue(true);
  });
```

   The added `mockIsTokenFresh.mockReturnValue(true)` default matters: several existing tests never call `getAccessToken()` and so never cared what `isTokenFresh` returned. Task 3 will start calling `getAccessToken()` automatically on every render, so from Task 3 onward every test needs a sane default (a token that nothing has told us is stale should read as fresh); tests that want to exercise the stale/refresh path already call `mockIsTokenFresh.mockReturnValue(false)` explicitly, which overrides this default. Setting it now (Task 2) keeps this infrastructure change bundled with the first task that touches shared test setup, so Task 3 doesn't have to touch this file's `beforeEach` again.

3. Extend the `AuthConsumer` test harness with the two new context fields:

```tsx
function AuthConsumer() {
  const auth = useAuth();
  const [resolvedToken, setResolvedToken] = useState('unset');

  return (
    <View>
      <Text testID="loading">{String(auth.isLoading)}</Text>
      <Text testID="authenticated">{String(auth.isAuthenticated)}</Text>
      <Text testID="access-token">{auth.accessToken ?? 'null'}</Text>
      <Text testID="error">{auth.error ?? 'null'}</Text>
      <Text testID="resolved-token">{resolvedToken}</Text>
      <Text testID="session-expired">{String(auth.sessionExpired)}</Text>
      <Pressable onPress={() => void auth.signIn()}>
        <Text>Sign in</Text>
      </Pressable>
      <Pressable onPress={() => void auth.signOut()}>
        <Text>Sign out</Text>
      </Pressable>
      <Pressable onPress={() => auth.dismissSessionExpiredNotice()}>
        <Text>Dismiss session notice</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          void auth.getAccessToken().then((token) => setResolvedToken(token ?? 'null'));
        }}
      >
        <Text>Get token</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          void Promise.all([auth.getAccessToken(), auth.getAccessToken()]).then((tokens) =>
            setResolvedToken(tokens.map((token) => token ?? 'null').join(',')),
          );
        }}
      >
        <Text>Get token twice</Text>
      </Pressable>
    </View>
  );
}
```

4. Add three new tests inside `describe('AuthProvider', ...)`, after the last existing test (`'exchanges a successful authorization code and persists the token'`) and before the closing `});`:

```ts
  test('does not mark the session as expired for a guest who has never signed in', async () => {
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    expect(screen.getByTestId('authenticated').props.children).toBe('false');
    expect(screen.getByTestId('session-expired').props.children).toBe('false');
  });

  test('marks the session expired after a previously signed-in session fails to refresh', async () => {
    mockPromptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'authorization-code' },
    });
    mockExchangeCodeAsync.mockResolvedValue({
      accessToken: 'signed-in-access-token',
      expiresIn: 3600,
      issuedAt: 1_700_000_300,
      refreshToken: 'signed-in-refresh-token',
      tokenType: 'bearer',
    });
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    await fireEvent.press(screen.getByText('Sign in'));
    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('true'));
    expect(tokenStore.writeHasEverSignedIn).toHaveBeenCalled();
    expect(screen.getByTestId('session-expired').props.children).toBe('false');

    mockIsTokenFresh.mockReturnValue(false);
    mockRefreshAsync.mockRejectedValue(new Error('refresh rejected'));
    await fireEvent.press(screen.getByText('Get token'));

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').props.children).toBe('false');
      expect(screen.getByTestId('session-expired').props.children).toBe('true');
    });
  });

  test('dismissing the notice hides it until a subsequent sign-in re-arms it', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    tokenStore.readHasEverSignedIn.mockResolvedValue(true);
    mockIsTokenFresh.mockReturnValue(false);
    mockRefreshAsync.mockRejectedValue(new Error('refresh rejected'));
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    await fireEvent.press(screen.getByText('Get token'));
    await waitFor(() => expect(screen.getByTestId('session-expired').props.children).toBe('true'));

    await fireEvent.press(screen.getByText('Dismiss session notice'));
    expect(screen.getByTestId('session-expired').props.children).toBe('false');

    mockPromptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'authorization-code' },
    });
    mockExchangeCodeAsync.mockResolvedValue({
      accessToken: 'new-access-token',
      expiresIn: 3600,
      issuedAt: 1_700_000_500,
      refreshToken: 'new-refresh-token',
      tokenType: 'bearer',
    });
    await fireEvent.press(screen.getByText('Sign in'));
    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('true'));

    mockRefreshAsync.mockRejectedValue(new Error('refresh rejected again'));
    await fireEvent.press(screen.getByText('Get token'));

    await waitFor(() => expect(screen.getByTestId('session-expired').props.children).toBe('true'));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/auth/AuthProvider.test.tsx`
Expected: FAIL — `auth.sessionExpired` / `auth.dismissSessionExpiredNotice` are `undefined` on the context value; the new tests fail their assertions (and TypeScript will flag `dismissSessionExpiredNotice` and `sessionExpired` as not existing on `AuthContextValue` — that's expected until Step 3).

- [ ] **Step 3: Implement the minimal code**

In `src/auth/types.ts`, add the two new fields to `AuthContextValue`:

```ts
export type PersistedAuthSession = {
  accessToken: string;
  expiresIn?: number;
  idToken?: string;
  issuedAt: number;
  refreshToken?: string;
  scope?: string;
  state?: string;
  tokenType?: 'bearer' | 'mac';
};

export type AuthContextValue = {
  accessToken: string | null;
  dismissSessionExpiredNotice(): void;
  error: string | null;
  getAccessToken(forceRefresh?: boolean): Promise<string | null>;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionExpired: boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};
```

In `src/auth/AuthProvider.tsx`:

1. Update the import from `./tokenStore`:

```ts
import { clearAuthSession, readAuthSession, readHasEverSignedIn, writeAuthSession, writeHasEverSignedIn } from './tokenStore';
```

2. In `UnconfiguredAuthProvider`, add an inert dismiss action and `sessionExpired: false`:

```ts
function UnconfiguredAuthProvider({ children }: PropsWithChildren) {
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => null, []);
  const signIn = useCallback(async () => {
    setError(SIGN_IN_NOT_CONFIGURED_ERROR);
  }, []);
  const signOut = useCallback(async () => {
    await clearAuthSession();
    setError(null);
  }, []);
  const dismissSessionExpiredNotice = useCallback(() => {}, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken: null,
      dismissSessionExpiredNotice,
      error,
      getAccessToken,
      isAuthenticated: false,
      isLoading: false,
      sessionExpired: false,
      signIn,
      signOut,
    }),
    [dismissSessionExpiredNotice, error, getAccessToken, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

3. In `ConfiguredAuthProvider`, add the two new pieces of state right after the existing `isLoading` state, and update `updateSession` to reset `dismissed` on a null→non-null transition:

```ts
  const [session, setSession] = useState<PersistedAuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasEverSignedIn, setHasEverSignedIn] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mountedRef = useRef(true);
  const mutationVersionRef = useRef(0);
  const sessionRef = useRef<PersistedAuthSession | null>(null);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  const updateSession = useCallback((nextSession: PersistedAuthSession | null) => {
    const wasAuthenticated = sessionRef.current !== null;
    sessionRef.current = nextSession;
    if (mountedRef.current) {
      setSession(nextSession);
      if (!wasAuthenticated && nextSession !== null) {
        setDismissed(false);
      }
    }
  }, []);
```

4. Add a new effect, right after the existing session-restore `useEffect` (the one calling `readAuthSession()`), to load `hasEverSignedIn`:

```ts
  useEffect(() => {
    let active = true;
    void readHasEverSignedIn().then((value) => {
      if (active) {
        setHasEverSignedIn(value);
      }
    });
    return () => {
      active = false;
    };
  }, []);
```

5. In `signIn()`, record `hasEverSignedIn` right after the existing `updateSession(nextSession);` call in the success path:

```ts
      await writeAuthSession(nextSession);
      if (signInVersion !== mutationVersionRef.current) {
        await clearAuthSession();
        return;
      }

      updateSession(nextSession);
      setHasEverSignedIn(true);
      void writeHasEverSignedIn();
```

6. Add `dismissSessionExpiredNotice` and the derived `sessionExpired` value, right before the `value` `useMemo` at the bottom of `ConfiguredAuthProvider`:

```ts
  const dismissSessionExpiredNotice = useCallback(() => {
    setDismissed(true);
  }, []);

  const sessionExpired = hasEverSignedIn && session === null && !isLoading && !dismissed;

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken: session?.accessToken ?? null,
      dismissSessionExpiredNotice,
      error,
      getAccessToken,
      isAuthenticated: session !== null,
      isLoading,
      sessionExpired,
      signIn,
      signOut,
    }),
    [
      dismissSessionExpiredNotice,
      error,
      getAccessToken,
      isLoading,
      session,
      sessionExpired,
      signIn,
      signOut,
    ],
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/auth/AuthProvider.test.tsx`
Expected: PASS — all existing tests plus the 3 new ones.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/auth/AuthProvider.tsx src/auth/AuthProvider.test.tsx src/auth/types.ts
git commit -m "feat(auth): derive sessionExpired from hasEverSignedIn and support dismissal"
```

---

## Task 3: Check session validity proactively on launch and foreground

**Files:**
- Modify: `src/auth/AuthProvider.tsx`
- Test: `src/auth/AuthProvider.test.tsx`

**Interfaces:**
- Consumes: `getAccessToken()` (existing, unchanged signature) — this task only changes when it's invoked, not its internals.
- Produces: nothing new for other tasks to consume; this task is about triggering existing behavior at new times.

- [ ] **Step 1: Write the failing tests**

Add to `src/auth/AuthProvider.test.tsx`:

1. Extend the existing `react-native` import at the top of the file to also pull in `AppState`:

```ts
import { AppState, Pressable, Text, View } from 'react-native';
```

2. Add three new tests inside `describe('AuthProvider', ...)`, after the tests added in Task 2:

```ts
  test('runs a silent refresh at launch without any user action', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    mockIsTokenFresh.mockReturnValue(false);
    mockRefreshAsync.mockResolvedValue({
      accessToken: 'launch-refreshed-token',
      expiresIn: 3600,
      issuedAt: 1_700_000_600,
      tokenType: 'bearer',
    });
    const screen = await renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('access-token').props.children).toBe('launch-refreshed-token');
    });
    expect(mockRefreshAsync).toHaveBeenCalledTimes(1);
  });

  test('runs a silent refresh again when the app returns to the foreground', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    mockIsTokenFresh.mockReturnValue(false);
    mockRefreshAsync.mockResolvedValueOnce({
      accessToken: 'first-refresh-token',
      expiresIn: 3600,
      issuedAt: 1_700_000_700,
      tokenType: 'bearer',
    });
    const screen = await renderProvider();
    await waitFor(() => expect(mockRefreshAsync).toHaveBeenCalledTimes(1));

    mockRefreshAsync.mockResolvedValueOnce({
      accessToken: 'foregrounded-refresh-token',
      expiresIn: 3600,
      issuedAt: 1_700_000_800,
      tokenType: 'bearer',
    });
    const changeHandler = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
    await act(async () => {
      changeHandler('active');
    });

    await waitFor(() => {
      expect(screen.getByTestId('access-token').props.children).toBe('foregrounded-refresh-token');
    });
    expect(mockRefreshAsync).toHaveBeenCalledTimes(2);
  });

  test('does not attempt a refresh at launch when there is no stored session', async () => {
    tokenStore.read.mockResolvedValue(null);
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    expect(mockRefreshAsync).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/auth/AuthProvider.test.tsx`
Expected: FAIL — the 3 new tests fail because nothing currently calls `getAccessToken()` automatically (no refresh happens without a button press, so `access-token` stays `'fresh-access-token'` instead of the mocked refreshed value, and `mockRefreshAsync` is never called).

- [ ] **Step 3: Implement the minimal code**

In `src/auth/AuthProvider.tsx`:

1. Add the `AppState` import from `react-native`:

```ts
import * as AuthSession from 'expo-auth-session';
import React, {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { getOidcClientConfig, type OidcClientConfig } from './config';
import { clearAuthSession, readAuthSession, readHasEverSignedIn, writeAuthSession, writeHasEverSignedIn } from './tokenStore';
import type { AuthContextValue, PersistedAuthSession } from './types';
```

2. In `ConfiguredAuthProvider`, add a new effect right after the `getAccessToken` `useCallback` definition (before `signIn`):

```ts
  useEffect(() => {
    if (isLoading) {
      return;
    }
    void getAccessToken();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void getAccessToken();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [getAccessToken, isLoading]);
```

   This runs once the initial session restore has finished (covers cold launch) and re-runs the same check every time the app becomes `active` again. `getAccessToken()` already contains the full freshness-check → refresh → `expireSession()`-on-failure chain; calling it with no stored session (`sessionRef.current === null`) is already a safe no-op (`if (!currentSession) return null;`), so this needs no extra guard.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/auth/AuthProvider.test.tsx`
Expected: PASS — full file, including all pre-existing tests (verifying no regressions from the new proactive check) and the 3 new ones.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/auth/AuthProvider.tsx src/auth/AuthProvider.test.tsx
git commit -m "feat(auth): check session validity on launch and app foreground"
```

---

## Task 4: `SessionExpiredBanner` component

**Files:**
- Create: `src/components/SessionExpiredBanner.tsx`
- Test: `src/components/SessionExpiredBanner.test.tsx`

**Interfaces:**
- Produces: `SessionExpiredBanner({ sessionExpired: boolean; onDismiss: () => void; onSignIn: () => void }): JSX.Element | null` — consumed by `App.tsx` in Task 5.
- This is a plain presentational component (props only, no `useAuth()` call inside it), matching the existing `SignInSheet` pattern in this codebase — keeps it independently testable without mocking context.

- [ ] **Step 1: Write the failing tests**

Create `src/components/SessionExpiredBanner.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import { SessionExpiredBanner } from './SessionExpiredBanner';

test('renders nothing when the session has not expired', async () => {
  const screen = await render(
    <SessionExpiredBanner sessionExpired={false} onDismiss={jest.fn()} onSignIn={jest.fn()} />,
  );
  expect(screen.toJSON()).toBeNull();
});

test('shows the reminder and starts sign-in when tapped', async () => {
  const onSignIn = jest.fn();
  const screen = await render(
    <SessionExpiredBanner sessionExpired={true} onDismiss={jest.fn()} onSignIn={onSignIn} />,
  );
  expect(
    screen.getByText(
      'Your sign-in has expired. Sign in again to ask questions and sync your library.',
    ),
  ).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(onSignIn).toHaveBeenCalledTimes(1);
});

test('calls onDismiss when the dismiss button is pressed', async () => {
  const onDismiss = jest.fn();
  const screen = await render(
    <SessionExpiredBanner sessionExpired={true} onDismiss={onDismiss} onSignIn={jest.fn()} />,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/SessionExpiredBanner.test.tsx`
Expected: FAIL — cannot find module `./SessionExpiredBanner`.

- [ ] **Step 3: Implement the minimal code**

Create `src/components/SessionExpiredBanner.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type SessionExpiredBannerProps = {
  sessionExpired: boolean;
  onDismiss: () => void;
  onSignIn: () => void;
};

export function SessionExpiredBanner({
  sessionExpired,
  onDismiss,
  onSignIn,
}: SessionExpiredBannerProps) {
  if (!sessionExpired) {
    return null;
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        Your sign-in has expired. Sign in again to ask questions and sync your library.
      </Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.signInButton}>
          <Text style={styles.signInText}>Sign in</Text>
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
  signInButton: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  signInText: {
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

Run: `npx jest src/components/SessionExpiredBanner.test.tsx`
Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionExpiredBanner.tsx src/components/SessionExpiredBanner.test.tsx
git commit -m "feat(auth): add SessionExpiredBanner component"
```

---

## Task 5: Wire the banner into `App.tsx`

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `sessionExpired`, `dismissSessionExpiredNotice` from `useAuth()` (Task 2); `SessionExpiredBanner` (Task 4); existing `isSignInOpen` / `setIsSignInOpen` state (`App.tsx:2370`).

- [ ] **Step 1: Add the import**

In `App.tsx`, add the import next to the other `./src/components/*` imports (around line 40):

```ts
import { SessionExpiredBanner } from './src/components/SessionExpiredBanner';
```

- [ ] **Step 2: Destructure the new context fields**

At `App.tsx:2368`, widen the existing destructure:

```ts
  const {
    error: authError,
    getAccessToken,
    isAuthenticated,
    isLoading: isAuthLoading,
    sessionExpired,
    dismissSessionExpiredNotice,
    signIn,
    signOut,
  } = useAuth();
```

- [ ] **Step 3: Render the banner**

In the JSX returned by `ReaderApp`, add `<SessionExpiredBanner ... />` as a sibling right before the existing `{isSignInOpen ? (<SignInSheet ...` block (around `App.tsx:3824`):

```tsx
      <SessionExpiredBanner
        onDismiss={dismissSessionExpiredNotice}
        onSignIn={() => setIsSignInOpen(true)}
        sessionExpired={sessionExpired && !isSignInOpen}
      />

      {isSignInOpen ? (
        <SignInSheet
          error={authError}
          isLoading={isSigningIn}
          onClose={() => {
            setIsSignInOpen(false);
            setPendingAuthenticatedAction(null);
          }}
          onSignIn={async () => {
            setIsSigningIn(true);
            await signIn();
            setIsSigningIn(false);
            // If there is a pendingAuthenticatedAction, the useEffect watching
            // isAuthenticated will dispatch it once the auth state updates.
            if (!pendingAuthenticatedAction) {
              setIsSignInOpen(false);
            }
          }}
        />
      ) : null}
```

   `sessionExpired && !isSignInOpen` keeps the banner from double-rendering underneath the modal sheet while the user is already looking at the sign-in flow (whether they opened it via the banner's "Sign in" button or via one of the existing reactive triggers).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full frontend test suite**

Run: `npx jest`
Expected: PASS — no regressions in any existing suite (in particular `App.test.tsx` if one exists, and every suite touching `useAuth`/`AuthProvider`).

- [ ] **Step 6: Commit**

```bash
git add App.tsx
git commit -m "feat(auth): show a dismissible banner when the session has expired"
```

---

## Manual verification (after all tasks)

Not automatable in this repo's test suite — do this once on a device/simulator before considering the feature done:

1. Sign in.
2. Background the app (don't force-quit).
3. Simulate expiry: either wait past the access/refresh token lifetime, or (faster) revoke the session server-side / temporarily point `EXPO_PUBLIC_OIDC_*` env vars at a config where the refresh call will fail.
4. Foreground the app again — confirm the banner appears at the top without touching any gated feature (don't tap Ask/Import/Scan/Index first).
5. Tap the banner's dismiss (✕) — confirm it disappears, and background/foreground the app again within the same session — confirm it stays hidden.
6. Tap a gated action (e.g. Ask) — confirm the existing reactive `SignInSheet` still opens normally, independent of the banner having been dismissed.
7. Sign in again through that sheet, then force a second expiry — confirm the banner is able to reappear (dismissal isn't permanent across sign-in cycles).
8. As a guest who has never signed in on a fresh install: background/foreground the app repeatedly — confirm the banner never appears.
