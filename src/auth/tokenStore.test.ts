import * as SecureStore from 'expo-secure-store';

import type { PersistedAuthSession } from './types';
import { clearAuthSession, readAuthSession, writeAuthSession } from './tokenStore';

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const secureStore = jest.mocked(SecureStore);
const SESSION_KEY = 'ai-reader-auth-session';

const session: PersistedAuthSession = {
  accessToken: 'access-token',
  expiresIn: 3600,
  idToken: 'id-token',
  issuedAt: 1_700_000_000,
  refreshToken: 'refresh-token',
  scope: 'openid profile email offline_access',
  tokenType: 'bearer',
};

describe('tokenStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reads and validates a stored session', async () => {
    secureStore.getItemAsync.mockResolvedValue(JSON.stringify(session));

    await expect(readAuthSession()).resolves.toEqual(session);
    expect(secureStore.getItemAsync).toHaveBeenCalledWith(SESSION_KEY);
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  test('writes only persisted session fields', async () => {
    const unsafeSession = { ...session, clientSecret: 'must-not-be-stored' };

    await writeAuthSession(unsafeSession as PersistedAuthSession);

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      JSON.stringify(session),
    );
  });

  test('clears the stored session', async () => {
    await clearAuthSession();

    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);
  });

  test('clears corrupt JSON and returns null', async () => {
    secureStore.getItemAsync.mockResolvedValue('{not-json');

    await expect(readAuthSession()).resolves.toBeNull();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);
  });

  test('clears invalid session data and returns null', async () => {
    secureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ accessToken: 'access-token', issuedAt: 'yesterday' }),
    );

    await expect(readAuthSession()).resolves.toBeNull();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);
  });
});
