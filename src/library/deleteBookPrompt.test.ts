import { buildDeleteBookPrompt } from './deleteBookPrompt';

function book(opts: { title?: string; notes?: number; cloudBookId?: string } = {}) {
  return {
    book: { title: opts.title ?? 'The Gold-Bug' },
    savedInsights: new Array(opts.notes ?? 0).fill({}),
    wholeBookAi: { cloudBookId: opts.cloudBookId },
  };
}

test('names the book so a mis-tap is obvious before it is confirmed', () => {
  expect(buildDeleteBookPrompt(book({ title: 'The Raven' })).title).toBe('Delete "The Raven"?');
});

test('says how many notes go with it', () => {
  expect(buildDeleteBookPrompt(book({ notes: 12 })).message).toContain('12 saved notes');
});

test('uses the singular for one note', () => {
  expect(buildDeleteBookPrompt(book({ notes: 1 })).message).toContain('1 saved note');
  expect(buildDeleteBookPrompt(book({ notes: 1 })).message).not.toContain('notes');
});

test('says nothing about notes when there are none', () => {
  expect(buildDeleteBookPrompt(book({ notes: 0 })).message).not.toContain('note');
});

test('warns that the uploaded copy goes too when the book was indexed', () => {
  const message = buildDeleteBookPrompt(book({ cloudBookId: 'cloud-1' })).message;

  expect(message).toContain('uploaded copy');
});

test('does not mention a server copy for a book that was never uploaded', () => {
  expect(buildDeleteBookPrompt(book()).message).not.toContain('uploaded');
});

test('always says it cannot be undone', () => {
  expect(buildDeleteBookPrompt(book()).message).toContain("can't be undone");
  expect(buildDeleteBookPrompt(book({ notes: 3, cloudBookId: 'c' })).message).toContain("can't be undone");
});

test('the confirm button says what it does, not "OK"', () => {
  expect(buildDeleteBookPrompt(book()).confirmLabel).toBe('Delete');
});
