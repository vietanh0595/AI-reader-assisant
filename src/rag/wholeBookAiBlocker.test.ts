import { wholeBookAiBlocker } from './wholeBookAiBlocker';

test('nothing blocks a ready book for a signed-in reader', () => {
  expect(wholeBookAiBlocker({ status: 'ready', isAuthenticated: true })).toBe('none');
});

test('a book that was never indexed is blocked on indexing', () => {
  expect(wholeBookAiBlocker({ status: 'not_enabled', isAuthenticated: true })).toBe('not_indexed');
});

test('a ready book with an expired session is blocked on signing in, not indexing', () => {
  // These used to be one check, so an expired session opened the Whole-Book AI
  // sheet — which reads its own state, still sees "ready", and offers "Start
  // asking". That button only closes the sheet, so the reader loops for ever.
  expect(wholeBookAiBlocker({ status: 'ready', isAuthenticated: false })).toBe('signed_out');
});

test('an unindexed book for a signed-out reader is blocked on signing in first', () => {
  // Indexing needs an account anyway, so sign-in is the first obstacle and the
  // Whole-Book AI sheet would strand them the same way.
  expect(wholeBookAiBlocker({ status: 'not_enabled', isAuthenticated: false })).toBe('signed_out');
});

test('a book midway through indexing is not treated as ready', () => {
  for (const status of ['uploading', 'queued', 'indexing', 'failed', 'deleting'] as const) {
    expect(wholeBookAiBlocker({ status, isAuthenticated: true })).toBe('not_indexed');
  }
});
