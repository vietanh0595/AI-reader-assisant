import { fetchWithRetry, isRetriableNetworkError } from './fetchWithRetry';

const ok = () => ({ ok: true, status: 200 }) as unknown as Response;
const networkError = () => new TypeError('Network request failed');

function makeFetch(...outcomes: (Response | Error)[]) {
  const calls: unknown[] = [];
  const impl = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const outcome = outcomes[calls.length - 1];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  return { calls, impl: impl as unknown as typeof fetch };
}

const noSleep = async () => {};

describe('fetchWithRetry', () => {
  it('returns the response when the first attempt succeeds', async () => {
    const { impl } = makeFetch(ok());
    const response = await fetchWithRetry('https://api/x', {}, { fetchImpl: impl, sleep: noSleep });
    expect(response.status).toBe(200);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  // The bug this exists for: iOS reuses a keep-alive socket that Render's edge
  // has already closed, so the very next request fails instantly at the
  // transport layer. Nothing reached the server, so a second attempt is safe
  // and opens a fresh connection.
  it('retries once after an instant network failure and succeeds', async () => {
    const { impl } = makeFetch(networkError(), ok());
    const response = await fetchWithRetry('https://api/x', {}, { fetchImpl: impl, sleep: noSleep });
    expect(response.status).toBe(200);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry and rethrows the original error', async () => {
    const { impl } = makeFetch(networkError(), networkError());
    await expect(
      fetchWithRetry('https://api/x', {}, { fetchImpl: impl, sleep: noSleep }),
    ).rejects.toThrow('Network request failed');
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a response that arrived, even a failing one', async () => {
    const { impl } = makeFetch({ ok: false, status: 500 } as unknown as Response);
    const response = await fetchWithRetry('https://api/x', {}, { fetchImpl: impl, sleep: noSleep });
    expect(response.status).toBe(500);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('passes method, headers and body through unchanged on both attempts', async () => {
    const { calls, impl } = makeFetch(networkError(), ok());
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' };
    await fetchWithRetry('https://api/x', init, { fetchImpl: impl, sleep: noSleep });
    for (const call of calls as { url: string; init: RequestInit }[]) {
      expect(call.url).toBe('https://api/x');
      expect(call.init.method).toBe('POST');
      expect(call.init.body).toBe('{"a":1}');
    }
  });

  it('aborts a request that exceeds the timeout', async () => {
    const impl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    ) as unknown as typeof fetch;

    const pending = fetchWithRetry(
      'https://api/x',
      {},
      { fetchImpl: impl, timeoutMs: 10, sleep: noSleep },
    );
    await expect(pending).rejects.toThrow(/took too long/i);
  });

  // A timeout means the server probably DID get the request and is still
  // working. Retrying would start a second expensive model call and double the
  // reader's wait, so timeouts are deliberately not retried.
  it('does not retry after a timeout', async () => {
    const impl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchWithRetry('https://api/x', {}, { fetchImpl: impl, timeoutMs: 10, sleep: noSleep }),
    ).rejects.toThrow(/took too long/i);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('respects a caller-supplied abort signal without waiting for the timeout', async () => {
    const controller = new AbortController();
    const impl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    ) as unknown as typeof fetch;

    const pending = fetchWithRetry(
      'https://api/x',
      { signal: controller.signal },
      { fetchImpl: impl, timeoutMs: 60_000, sleep: noSleep },
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(impl).toHaveBeenCalledTimes(1);
  });
});

describe('isRetriableNetworkError', () => {
  it('treats a transport failure as retriable', () => {
    expect(isRetriableNetworkError(new TypeError('Network request failed'))).toBe(true);
  });

  it('does not treat an abort as retriable', () => {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    expect(isRetriableNetworkError(error)).toBe(false);
  });
});
