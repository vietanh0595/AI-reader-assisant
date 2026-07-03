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

import { getOidcClientConfig, type OidcClientConfig } from './config';
import {
  clearAuthSession,
  readAuthSession,
  readHasEverSignedIn,
  writeAuthSession,
  writeHasEverSignedIn,
} from './tokenStore';
import type { AuthContextValue, PersistedAuthSession } from './types';

const REDIRECT_SCHEME = 'aibookreader';
const SIGN_IN_NOT_CONFIGURED_ERROR = 'Sign-in is not configured on this build.';
const SIGN_IN_EXPIRED_ERROR = 'Your sign-in session has expired. Please sign in again.';
const SIGN_IN_NOT_READY_ERROR = 'Sign-in is not ready. Please try again.';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function toPersistedSession(
  token: AuthSession.TokenResponse,
  fallbackRefreshToken?: string,
): PersistedAuthSession {
  return {
    accessToken: token.accessToken,
    expiresIn: token.expiresIn,
    idToken: token.idToken,
    issuedAt: token.issuedAt,
    refreshToken: token.refreshToken ?? fallbackRefreshToken,
    scope: token.scope,
    state: token.state,
    tokenType: token.tokenType,
  };
}

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

type ConfiguredAuthProviderProps = PropsWithChildren<{
  config: OidcClientConfig;
}>;

function ConfiguredAuthProvider({ children, config }: ConfiguredAuthProviderProps) {
  const discovery = AuthSession.useAutoDiscovery(config.issuerUrl);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: REDIRECT_SCHEME, path: 'callback' });
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: config.clientId,
      extraParams: { audience: config.audience },
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: config.scopes,
      usePKCE: true,
    },
    discovery,
  );
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

  useEffect(() => {
    mountedRef.current = true;
    const restoreVersion = mutationVersionRef.current;
    let active = true;

    void readAuthSession()
      .then((storedSession) => {
        if (active && restoreVersion === mutationVersionRef.current) {
          updateSession(storedSession);
        }
      })
      .catch(() => {
        if (active && mountedRef.current) {
          setError('Unable to restore the sign-in session.');
        }
      })
      .finally(() => {
        if (active && mountedRef.current) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      mountedRef.current = false;
    };
  }, [updateSession]);

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

  const expireSession = useCallback(async (): Promise<null> => {
    mutationVersionRef.current += 1;
    updateSession(null);
    if (mountedRef.current) {
      setError(SIGN_IN_EXPIRED_ERROR);
    }
    try {
      await clearAuthSession();
    } catch {
      // Local session state remains authoritative when secure storage is unavailable.
    }
    return null;
  }, [updateSession]);

  const getAccessToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      const currentSession = sessionRef.current;
      if (!currentSession) {
        return null;
      }

      if (!forceRefresh && AuthSession.TokenResponse.isTokenFresh(currentSession)) {
        return currentSession.accessToken;
      }

      if (refreshPromiseRef.current) {
        return refreshPromiseRef.current;
      }

      if (!currentSession.refreshToken) {
        return expireSession();
      }

      if (!discovery?.tokenEndpoint) {
        return null;
      }

      const refreshVersion = mutationVersionRef.current;
      const refreshPromise = (async () => {
        try {
          const token = await AuthSession.refreshAsync(
            {
              clientId: config.clientId,
              refreshToken: currentSession.refreshToken,
              scopes: config.scopes,
            },
            discovery,
          );
          const replacement = toPersistedSession(token, currentSession.refreshToken);

          if (refreshVersion !== mutationVersionRef.current) {
            return null;
          }

          await writeAuthSession(replacement);
          if (refreshVersion !== mutationVersionRef.current) {
            await clearAuthSession();
            return null;
          }

          updateSession(replacement);
          if (mountedRef.current) {
            setError(null);
          }
          return replacement.accessToken;
        } catch {
          if (refreshVersion !== mutationVersionRef.current) {
            return null;
          }
          return expireSession();
        }
      })();

      refreshPromiseRef.current = refreshPromise;
      try {
        return await refreshPromise;
      } finally {
        if (refreshPromiseRef.current === refreshPromise) {
          refreshPromiseRef.current = null;
        }
      }
    },
    [config.clientId, config.scopes, discovery, expireSession, updateSession],
  );

  const signIn = useCallback(async () => {
    if (!request || !request.codeVerifier || !discovery?.tokenEndpoint) {
      if (mountedRef.current) {
        setError(SIGN_IN_NOT_READY_ERROR);
      }
      return;
    }

    const signInVersion = mutationVersionRef.current + 1;
    mutationVersionRef.current = signInVersion;
    if (mountedRef.current) {
      setError(null);
    }

    try {
      const result = await promptAsync();
      if (result.type !== 'success') {
        if (result.type === 'error' && mountedRef.current) {
          setError(result.error?.message ?? 'Sign-in failed.');
        }
        return;
      }

      const code = result.params.code;
      if (!code) {
        throw new Error('Sign-in did not return an authorization code.');
      }

      const token = await AuthSession.exchangeCodeAsync(
        {
          clientId: config.clientId,
          code,
          extraParams: { code_verifier: request.codeVerifier },
          redirectUri,
        },
        discovery,
      );
      const nextSession = toPersistedSession(token);

      if (signInVersion !== mutationVersionRef.current) {
        return;
      }

      await writeAuthSession(nextSession);
      if (signInVersion !== mutationVersionRef.current) {
        await clearAuthSession();
        return;
      }

      updateSession(nextSession);
      setHasEverSignedIn(true);
      void writeHasEverSignedIn();
    } catch (signInError) {
      if (mountedRef.current && signInVersion === mutationVersionRef.current) {
        setError(signInError instanceof Error ? signInError.message : 'Sign-in failed.');
      }
    }
  }, [config.clientId, discovery, promptAsync, redirectUri, request, updateSession]);

  const signOut = useCallback(async () => {
    mutationVersionRef.current += 1;
    updateSession(null);
    if (mountedRef.current) {
      setError(null);
    }
    await clearAuthSession();
  }, [updateSession]);

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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const config = getOidcClientConfig();

  if (!config) {
    return <UnconfiguredAuthProvider>{children}</UnconfiguredAuthProvider>;
  }

  return <ConfiguredAuthProvider config={config}>{children}</ConfiguredAuthProvider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return value;
}
