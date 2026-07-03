import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { PersistedAuthSession } from './types';

const mockUseAutoDiscovery = jest.fn();
const mockUseAuthRequest = jest.fn();
const mockMakeRedirectUri = jest.fn();
const mockExchangeCodeAsync = jest.fn();
const mockRefreshAsync = jest.fn();
const mockIsTokenFresh = jest.fn();
const mockPromptAsync = jest.fn();

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

const discovery = {
  authorizationEndpoint: 'https://issuer.example.com/authorize',
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
