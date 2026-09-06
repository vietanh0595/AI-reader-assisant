import React, { useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { PersistedAuthSession } from './types';

const mockUseAutoDiscovery = jest.fn();
const mockUseAuthRequest = jest.fn();
const mockMakeRedirectUri = jest.fn();
const mockExchangeCodeAsync = jest.fn();
const mockRefreshAsync = jest.fn();
const mockIsTokenFresh = jest.fn();
const mockPromptAsync = jest.fn();
const mockOpenAuthSessionAsync = jest.fn();

jest.mock('expo-web-browser', () => ({
  __esModule: true,
  openAuthSessionAsync: mockOpenAuthSessionAsync,
}));

jest.mock('expo-auth-session', () => ({
  __esModule: true,
  ResponseType: { Code: 'code' },
  TokenResponse: { isTokenFresh: mockIsTokenFresh },
  exchangeCodeAsync: mockExchangeCodeAsync,
  makeRedirectUri: mockMakeRedirectUri,
  refreshAsync: mockRefreshAsync,
  useAuthRequest: mockUseAuthRequest,
  useAutoDiscovery: mockUseAutoDiscovery,
}));

jest.mock('./tokenStore', () => ({
  clearAuthSession: jest.fn(),
  clearHasEverSignedIn: jest.fn(),
  readAuthSession: jest.fn(),
  readHasEverSignedIn: jest.fn(),
  writeAuthSession: jest.fn(),
  writeHasEverSignedIn: jest.fn(),
}));

const { AuthProvider, useAuth } = require('./AuthProvider') as typeof import('./AuthProvider');
const {
  clearAuthSession,
  clearHasEverSignedIn,
  readAuthSession,
  readHasEverSignedIn,
  writeAuthSession,
  writeHasEverSignedIn,
} = require('./tokenStore') as typeof import('./tokenStore');

const tokenStore = {
  clear: jest.mocked(clearAuthSession),
  clearHasEverSignedIn: jest.mocked(clearHasEverSignedIn),
  read: jest.mocked(readAuthSession),
  readHasEverSignedIn: jest.mocked(readHasEverSignedIn),
  write: jest.mocked(writeAuthSession),
  writeHasEverSignedIn: jest.mocked(writeHasEverSignedIn),
};

const discovery = {
  authorizationEndpoint: 'https://issuer.example.com/authorize',
  endSessionEndpoint: 'https://issuer.example.com/oidc/logout',
  tokenEndpoint: 'https://issuer.example.com/oauth/token',
};

const authRequest = { codeVerifier: 'pkce-code-verifier' };

const freshSession: PersistedAuthSession = {
  accessToken: 'fresh-access-token',
  expiresIn: 3600,
  issuedAt: 1_700_000_000,
  refreshToken: 'refresh-token',
  tokenType: 'bearer',
};

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

async function renderProvider() {
  return await render(
    <AuthProvider>
      <AuthConsumer />
    </AuthProvider>,
  );
}

function setConfiguredEnvironment() {
  process.env.EXPO_PUBLIC_OIDC_ISSUER_URL = 'https://issuer.example.com';
  process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'mobile-client';
  process.env.EXPO_PUBLIC_OIDC_AUDIENCE = 'https://api.example.com';
}

function clearConfiguredEnvironment() {
  delete process.env.EXPO_PUBLIC_OIDC_ISSUER_URL;
  delete process.env.EXPO_PUBLIC_OIDC_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_OIDC_AUDIENCE;
}

describe('AuthProvider', () => {
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

  afterEach(() => {
    clearConfiguredEnvironment();
  });

  test('renders children without config and reports the exact sign-in error', async () => {
    clearConfiguredEnvironment();
    const screen = await renderProvider();

    expect(screen.getByTestId('loading').props.children).toBe('false');
    expect(screen.getByTestId('authenticated').props.children).toBe('false');

    await fireEvent.press(screen.getByText('Sign in'));

    await waitFor(() => {
      expect(screen.getByTestId('error').props.children).toBe(
        'Sign-in is not configured on this build.',
      );
    });
    expect(mockPromptAsync).not.toHaveBeenCalled();
    expect(mockUseAuthRequest).not.toHaveBeenCalled();
  });

  test('restores a fresh session as authenticated', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    const screen = await renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('loading').props.children).toBe('false');
      expect(screen.getByTestId('authenticated').props.children).toBe('true');
      expect(screen.getByTestId('access-token').props.children).toBe('fresh-access-token');
    });
  });

  test('refreshes a stale session and persists the replacement', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    mockIsTokenFresh.mockReturnValue(false);
    mockRefreshAsync.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      expiresIn: 7200,
      issuedAt: 1_700_000_100,
      tokenType: 'bearer',
    });
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    await fireEvent.press(screen.getByText('Get token'));

    await waitFor(() => {
      expect(screen.getByTestId('resolved-token').props.children).toBe(
        'refreshed-access-token',
      );
      expect(screen.getByTestId('access-token').props.children).toBe(
        'refreshed-access-token',
      );
    });
    expect(mockRefreshAsync).toHaveBeenCalledWith(
      {
        clientId: 'mobile-client',
        refreshToken: 'refresh-token',
        scopes: ['openid', 'profile', 'email', 'offline_access'],
      },
      discovery,
    );
    expect(tokenStore.write).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'refreshed-access-token',
        refreshToken: 'refresh-token',
      }),
    );
  });

  test('preserves a stale session while discovery is still loading', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    mockIsTokenFresh.mockReturnValue(false);
    mockUseAutoDiscovery.mockReturnValue(null);
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    await fireEvent.press(screen.getByText('Get token'));

    await waitFor(() => {
      expect(screen.getByTestId('resolved-token').props.children).toBe('null');
      expect(screen.getByTestId('authenticated').props.children).toBe('true');
    });
    expect(mockRefreshAsync).not.toHaveBeenCalled();
    expect(tokenStore.clear).not.toHaveBeenCalled();
  });

  test('shares one refresh across concurrent token requests', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    mockIsTokenFresh.mockReturnValue(false);
    let resolveRefresh!: (value: object) => void;
    mockRefreshAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    await fireEvent.press(screen.getByText('Get token twice'));
    await waitFor(() => expect(mockRefreshAsync).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveRefresh({
        accessToken: 'shared-access-token',
        expiresIn: 3600,
        issuedAt: 1_700_000_200,
        tokenType: 'bearer',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('resolved-token').props.children).toBe(
        'shared-access-token,shared-access-token',
      );
    });
    expect(mockRefreshAsync).toHaveBeenCalledTimes(1);
  });

  test('clears the session when refresh fails', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    mockIsTokenFresh.mockReturnValue(false);
    mockRefreshAsync.mockRejectedValue(new Error('refresh rejected'));
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    await fireEvent.press(screen.getByText('Get token'));

    await waitFor(() => {
      expect(screen.getByTestId('resolved-token').props.children).toBe('null');
      expect(screen.getByTestId('authenticated').props.children).toBe('false');
      expect(screen.getByTestId('error').props.children).toBe(
        'Your sign-in session has expired. Please sign in again.',
      );
    });
    expect(tokenStore.clear).toHaveBeenCalled();
  });

  test('keeps refresh failure behavior stable when storage cleanup fails', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    mockIsTokenFresh.mockReturnValue(false);
    mockRefreshAsync.mockRejectedValue(new Error('refresh rejected'));
    tokenStore.clear.mockRejectedValue(new Error('secure storage unavailable'));
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    await fireEvent.press(screen.getByText('Get token'));

    await waitFor(() => {
      expect(screen.getByTestId('resolved-token').props.children).toBe('null');
      expect(screen.getByTestId('authenticated').props.children).toBe('false');
      expect(screen.getByTestId('error').props.children).toBe(
        'Your sign-in session has expired. Please sign in again.',
      );
    });
  });

  test('does not let a failed in-flight refresh override sign-out state', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    mockIsTokenFresh.mockReturnValue(false);
    let rejectRefresh!: (reason: Error) => void;
    mockRefreshAsync.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRefresh = reject;
      }),
    );
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

    await fireEvent.press(screen.getByText('Get token'));
    await waitFor(() => expect(mockRefreshAsync).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByText('Sign out'));

    await act(async () => {
      rejectRefresh(new Error('refresh rejected after sign-out'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').props.children).toBe('false');
      expect(screen.getByTestId('error').props.children).toBe('null');
    });
    expect(tokenStore.clear).toHaveBeenCalledTimes(1);
  });

  test('a deliberate sign-out is not remembered as a lapsed session', async () => {
    // hasEverSignedIn is what turns a missing session into "your sign-in has
    // expired". It survives a relaunch, while the in-memory dismissal does not —
    // so without clearing it, someone who chose to sign out is told on next launch
    // that their session expired. They did not expire. They left.
    tokenStore.read.mockResolvedValue(freshSession);
    tokenStore.readHasEverSignedIn.mockResolvedValue(true);
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('true'));

    await fireEvent.press(screen.getByText('Sign out'));

    await waitFor(() => expect(tokenStore.clearHasEverSignedIn).toHaveBeenCalledTimes(1));
  });

  test('a session that lapsed on its own is still reported as expired', async () => {
    // The other half of the same rule: clearing the flag on a deliberate sign-out
    // must not blunt the notice for a real expiry, which is the case it exists for.
    mockPromptAsync.mockResolvedValue({ type: 'success', params: { code: 'authorization-code' } });
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

    mockIsTokenFresh.mockReturnValue(false);
    mockRefreshAsync.mockRejectedValue(new Error('refresh rejected'));
    await fireEvent.press(screen.getByText('Get token'));

    await waitFor(() => expect(screen.getByTestId('session-expired').props.children).toBe('true'));
    expect(tokenStore.clearHasEverSignedIn).not.toHaveBeenCalled();
  });

  test('signing out ends the provider session, not just the local one', async () => {
    // Clearing the tokens alone leaves the provider's cookie alive, so the next
    // sign-in skips the login screen and offers to continue as the previous
    // account — showing their email to whoever is now holding the phone.
    tokenStore.read.mockResolvedValue({ ...freshSession, idToken: 'stored-id-token' });
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('true'));

    await fireEvent.press(screen.getByText('Sign out'));

    await waitFor(() => expect(mockOpenAuthSessionAsync).toHaveBeenCalledTimes(1));
    const openedUrl = new URL(mockOpenAuthSessionAsync.mock.calls[0][0]);
    expect(openedUrl.origin + openedUrl.pathname).toBe('https://issuer.example.com/oidc/logout');
    expect(openedUrl.searchParams.get('id_token_hint')).toBe('stored-id-token');
    expect(openedUrl.searchParams.get('client_id')).toBe('mobile-client');
  });

  test('a provider with no logout endpoint still signs out locally', async () => {
    mockUseAutoDiscovery.mockReturnValue({ ...discovery, endSessionEndpoint: undefined });
    tokenStore.read.mockResolvedValue(freshSession);
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('true'));

    await fireEvent.press(screen.getByText('Sign out'));

    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('false'));
    expect(tokenStore.clear).toHaveBeenCalled();
    expect(mockOpenAuthSessionAsync).not.toHaveBeenCalled();
  });

  test('a browser that fails to open does not leave the user signed in', async () => {
    // The local sign-out is the part that must never depend on the network.
    mockOpenAuthSessionAsync.mockRejectedValue(new Error('no browser available'));
    tokenStore.read.mockResolvedValue(freshSession);
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('true'));

    await fireEvent.press(screen.getByText('Sign out'));

    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('false'));
    expect(tokenStore.clear).toHaveBeenCalled();
  });

  test('signs out by clearing local state and storage', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('true'));

    await fireEvent.press(screen.getByText('Sign out'));

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').props.children).toBe('false');
      expect(screen.getByTestId('access-token').props.children).toBe('null');
    });
    expect(tokenStore.clear).toHaveBeenCalled();
  });

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

  test('does not show the expired notice right after a deliberate sign-out', async () => {
    tokenStore.read.mockResolvedValue(freshSession);
    tokenStore.readHasEverSignedIn.mockResolvedValue(true);
    const screen = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('authenticated').props.children).toBe('true'));

    await fireEvent.press(screen.getByText('Sign out'));

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').props.children).toBe('false');
      expect(screen.getByTestId('session-expired').props.children).toBe('false');
    });
  });

  test('exchanges a successful authorization code and persists the token', async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').props.children).toBe('true');
      expect(screen.getByTestId('access-token').props.children).toBe(
        'signed-in-access-token',
      );
    });
    expect(mockMakeRedirectUri).toHaveBeenCalledWith({ scheme: 'aibookreader', path: 'callback' });
    expect(mockUseAuthRequest).toHaveBeenCalledWith(
      {
        clientId: 'mobile-client',
        extraParams: { audience: 'https://api.example.com' },
        redirectUri: 'aibookreader://',
        responseType: 'code',
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        usePKCE: true,
      },
      discovery,
    );
    expect(mockExchangeCodeAsync).toHaveBeenCalledWith(
      {
        clientId: 'mobile-client',
        code: 'authorization-code',
        extraParams: { code_verifier: 'pkce-code-verifier' },
        redirectUri: 'aibookreader://',
      },
      discovery,
    );
    expect(tokenStore.write).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'signed-in-access-token',
        refreshToken: 'signed-in-refresh-token',
      }),
    );
  });

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
});

describe('useAuth', () => {
  test('throws outside AuthProvider', async () => {
    function InvalidConsumer() {
      useAuth();
      return null;
    }

    await expect(render(<InvalidConsumer />)).rejects.toThrow(
      'useAuth must be used within an AuthProvider.',
    );
  });
});
