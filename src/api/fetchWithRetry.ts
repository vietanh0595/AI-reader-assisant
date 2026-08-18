// Network calls to the AI backend fail in two very different ways, and the
// difference decides whether retrying is safe.
//
// 1. The request never leaves the phone. iOS keeps the connection to the API
//    open between calls to save a handshake, but Render's edge closes idle
//    connections after a few seconds. The next request goes down a socket that
//    is already dead and fails instantly with "Network request failed" — with
//    nothing in the server logs or Sentry, because nothing arrived. Observed on
//    a real device on 2026-08-17: an answer succeeded, and the follow-up seconds
//    later failed. A second attempt opens a fresh connection and works.
//
// 2. The request arrived and the server is still working. Retrying that starts
//    a second expensive model call and doubles the reader's wait for no reason.
//
// So: retry transport failures, never retry timeouts.

export type FetchWithRetryOptions = {
  fetchImpl?: typeof fetch;
  /** How long to wait before giving up. Aborts the request. */
  timeoutMs?: number;
  /** Extra attempts after the first. One is enough for a stale socket. */
  retries?: number;
  /** Pause before the retry, so a momentary blip has time to clear. */
  retryDelayMs?: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 400;

/**
 * True when the request failed before reaching the server, so sending it again
 * cannot duplicate any work. An abort is excluded: it means we gave up on a
 * request that may well be in flight.
 */
export function isRetriableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'AbortError') {
    return false;
  }
  // React Native surfaces every transport-level failure as a TypeError with
  // this message — dead socket, DNS failure, no route. All are safe to repeat.
  return error.name === 'TypeError' || /network request failed/i.test(error.message);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    // A caller's own signal (a screen closing, a question replaced) must still
    // cancel the request, so forward it to the same controller.
    const callerSignal = init.signal;
    const forwardAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', forwardAbort);
    if (callerSignal?.aborted) {
      controller.abort();
    }

    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      lastError = timedOut
        ? new Error(`The request took too long and was cancelled after ${Math.round(timeoutMs / 1000)}s.`)
        : error;

      // Timeouts and caller cancellations are final; only a request that never
      // landed is worth sending again.
      if (timedOut || callerSignal?.aborted || !isRetriableNetworkError(error)) {
        throw lastError;
      }
      if (attempt === retries) {
        throw lastError;
      }
      await sleep(retryDelayMs);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  throw lastError;
}
