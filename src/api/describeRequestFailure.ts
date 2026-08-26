import { isRetriableNetworkError } from './fetchWithRetry';

// A reader who sees "Could not reach https://ai-reader-api-h93e.onrender.com/ai/assist"
// learns nothing and is shown our infrastructure. Endpoints are for logs, not for the
// error card. Anything that slips through the cases below has its URLs stripped as a
// backstop, so no future call site can leak one by accident.
const URL_PATTERN = /https?:\/\/\S+/g;

const GENERIC = 'The AI request failed. Please try again.';

export function describeRequestFailure(error: unknown): string {
  // The request never left the phone. "Network request failed" is fetch's wording,
  // not an explanation — say what the reader can do about it instead.
  if (isRetriableNetworkError(error)) {
    return "Couldn't reach the AI service. Check your connection and try again.";
  }

  if (!(error instanceof Error)) {
    return GENERIC;
  }

  // Everything else — timeouts, rate limits, real API errors — is already written for
  // a person and stays diagnosable, so it passes through unchanged.
  const cleaned = error.message.replace(URL_PATTERN, '').replace(/\s+/g, ' ').trim();

  return cleaned || GENERIC;
}
