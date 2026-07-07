import { selectPendingNotice } from './backgroundNotice';

test('returns null when no library items have a pending notice', () => {
  const result = selectPendingNotice([
    { id: 'book-1', book: { title: 'Book One' } },
    { id: 'book-2', book: { title: 'Book Two' } },
  ]);

  expect(result).toBeNull();
});

test('returns the single pending notice when only one exists', () => {
  const result = selectPendingNotice([
    { id: 'book-1', book: { title: 'Book One' } },
    {
      id: 'book-2',
      book: { title: 'Book Two' },
      pendingNotice: { kind: 'indexing', status: 'ready', notifiedAt: '2026-07-07T10:00:00.000Z' },
    },
  ]);

  expect(result).toEqual({
    bookId: 'book-2',
    bookTitle: 'Book Two',
    kind: 'indexing',
    status: 'ready',
  });
});

test('returns the oldest notice by notifiedAt when multiple exist', () => {
  const result = selectPendingNotice([
    {
      id: 'book-1',
      book: { title: 'Newer Book' },
      pendingNotice: { kind: 'mindmap', status: 'ready', notifiedAt: '2026-07-07T12:00:00.000Z' },
    },
    {
      id: 'book-2',
      book: { title: 'Older Book' },
      pendingNotice: { kind: 'indexing', status: 'failed', notifiedAt: '2026-07-07T09:00:00.000Z' },
    },
  ]);

  expect(result).toEqual({
    bookId: 'book-2',
    bookTitle: 'Older Book',
    kind: 'indexing',
    status: 'failed',
  });
});

test('ignores library items without a pending notice when others have one', () => {
  const result = selectPendingNotice([
    { id: 'book-1', book: { title: 'Untouched Book' } },
    {
      id: 'book-2',
      book: { title: 'Ready Book' },
      pendingNotice: { kind: 'mindmap', status: 'ready', notifiedAt: '2026-07-07T08:00:00.000Z' },
    },
  ]);

  expect(result?.bookId).toBe('book-2');
});
