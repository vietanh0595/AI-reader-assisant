/**
 * The human-readable part of an API error body.
 *
 * FastAPI puts `detail` at the top level, but it may be a plain string or a
 * structured object — the daily quota sends the latter so the app can tell a limit
 * from a failure and offer to sign in. Reading only the string form meant a reader
 * was shown raw JSON.
 */
export type ApiErrorInfo = {
  message: string;
  // Present only on a daily-allowance refusal. True means the caller has no
  // account, which is the one moment they have a concrete reason to make one.
  isGuest?: boolean;
};

export function readApiErrorInfo(bodyText: string): ApiErrorInfo | null {
  if (!bodyText.trim()) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // Not JSON at all — a proxy error page or a plain string. Better than nothing.
    return { message: bodyText };
  }

  const detail = isRecord(parsed) ? parsed.detail : undefined;

  if (typeof detail === 'string') {
    return { message: detail };
  }

  if (isRecord(detail) && typeof detail.message === 'string') {
    return {
      message: detail.message,
      isGuest: detail.isGuest === true,
    };
  }

  return { message: bodyText };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
