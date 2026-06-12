import * as SecureStore from 'expo-secure-store';

import type { PersistedAuthSession } from './types';

const AUTH_SESSION_KEY = 'ai-reader-auth-session';

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
    (candidate.tokenType === undefined ||
      candidate.tokenType === 'bearer' ||
      candidate.tokenType === 'mac')
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
