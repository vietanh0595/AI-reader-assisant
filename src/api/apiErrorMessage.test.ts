import { readApiErrorInfo } from './apiErrorMessage';

test('reads a plain string detail, which is what most errors send', () => {
  expect(readApiErrorInfo('{"detail":"Book not found"}')?.message).toBe('Book not found');
});

test('reads a structured detail, which the daily allowance sends', () => {
  // Reading only the string form showed the reader raw JSON.
  const body = JSON.stringify({
    detail: {
      error: 'daily_quota_exceeded',
      message: "You've used your 50 AI actions for today. They reset in about 2 hours.",
      isGuest: false,
    },
  });

  expect(readApiErrorInfo(body)?.message).toBe(
    "You've used your 50 AI actions for today. They reset in about 2 hours.",
  );
});

test('surfaces whether the caller was a guest, so the app can offer signing in', () => {
  const body = JSON.stringify({ detail: { message: 'Out of free actions.', isGuest: true } });

  expect(readApiErrorInfo(body)?.isGuest).toBe(true);
});

test('a signed-in refusal is not marked as a guest one', () => {
  const body = JSON.stringify({ detail: { message: 'Out of actions.', isGuest: false } });

  expect(readApiErrorInfo(body)?.isGuest).toBe(false);
});

test('falls back to the raw body when it is not JSON', () => {
  // A proxy or load balancer can return an HTML error page.
  expect(readApiErrorInfo('502 Bad Gateway')?.message).toBe('502 Bad Gateway');
});

test('an empty body yields nothing rather than an empty message', () => {
  expect(readApiErrorInfo('')).toBeNull();
  expect(readApiErrorInfo('   ')).toBeNull();
});
