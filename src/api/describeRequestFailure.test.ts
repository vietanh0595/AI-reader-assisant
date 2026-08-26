import { describeRequestFailure } from './describeRequestFailure';

function transportFailure() {
  // What fetch throws on iOS when the request never leaves the phone.
  return new TypeError('Network request failed');
}

test('a transport failure reads as a connection problem, not a raw fetch error', () => {
  expect(describeRequestFailure(transportFailure())).toBe(
    "Couldn't reach the AI service. Check your connection and try again.",
  );
});

test('a timeout keeps its own wording — the reader needs to know it was slow, not offline', () => {
  const timeout = new Error('The request took too long and was cancelled after 45s.');

  expect(describeRequestFailure(timeout)).toBe(
    'The request took too long and was cancelled after 45s.',
  );
});

test('an API endpoint is never shown to the reader', () => {
  const leaky = new Error(
    'Could not reach https://ai-reader-api-h93e.onrender.com/ai/assist. Network request failed',
  );

  expect(describeRequestFailure(leaky)).not.toContain('onrender.com');
});

test('an unrecognised error still says something a reader can act on', () => {
  expect(describeRequestFailure('kaboom')).toBe('The AI request failed. Please try again.');
});

test('a server-side message is passed through so real API errors stay diagnosable', () => {
  expect(describeRequestFailure(new Error('Rate limit reached. Try again in 5 minutes.'))).toBe(
    'Rate limit reached. Try again in 5 minutes.',
  );
});
