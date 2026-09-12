import { deleteAccount } from './deleteAccount';

function okResponse() {
  return { ok: true, status: 204 } as Response;
}

function serverError() {
  return { ok: false, status: 500 } as Response;
}

test('asks the server to delete the account, with the caller signed in', async () => {
  const fetchImpl = jest.fn(async () => okResponse());

  await deleteAccount({
    apiBaseUrl: 'https://api.example.com',
    accessToken: 'token-abc',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    signOut: jest.fn(),
  });

  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.example.com/auth/me');
  expect(init.method).toBe('DELETE');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
});

test('signs out immediately once the account is gone', async () => {
  // The access token stays valid after deletion, and the server provisions a user
  // from the token whenever one is missing — so any authenticated request made
  // after this would quietly recreate the account that was just deleted.
  const signOut = jest.fn();

  await deleteAccount({
    apiBaseUrl: 'https://api.example.com',
    accessToken: 'token-abc',
    fetchImpl: (async () => okResponse()) as unknown as typeof fetch,
    signOut,
  });

  expect(signOut).toHaveBeenCalledTimes(1);
});

test('a rejected delete leaves the reader signed in', async () => {
  // Signing out of an account that still exists would strand the reader: they
  // would believe it was deleted and have no obvious way to try again.
  const signOut = jest.fn();

  await expect(
    deleteAccount({
      apiBaseUrl: 'https://api.example.com',
      accessToken: 'token-abc',
      fetchImpl: (async () => serverError()) as unknown as typeof fetch,
      signOut,
    }),
  ).rejects.toThrow();

  expect(signOut).not.toHaveBeenCalled();
});

test('a connection failure is reported in words a reader can act on', async () => {
  const signOut = jest.fn();

  await expect(
    deleteAccount({
      apiBaseUrl: 'https://api.example.com',
      accessToken: 'token-abc',
      fetchImpl: (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch,
      signOut,
    }),
  ).rejects.toThrow(/connection/i);

  expect(signOut).not.toHaveBeenCalled();
});
