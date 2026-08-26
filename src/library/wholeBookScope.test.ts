import { isWholeBookScopeOn } from './wholeBookScope';
import type { WholeBookAiState } from '../rag/types';

function book(status: WholeBookAiState['status'], includeWholeBook?: boolean) {
  return { includeWholeBook, wholeBookAi: { acknowledgedBatch: -1, progress: 0, status } };
}

test('a book that was never switched to whole-book scope starts off', () => {
  expect(isWholeBookScopeOn(book('ready'))).toBe(false);
});

test('a saved choice is honoured when the book is still indexed', () => {
  expect(isWholeBookScopeOn(book('ready', true))).toBe(true);
});

test('a saved choice is ignored once the book is no longer indexed', () => {
  // The flag now outlives the app, so it can outlive the index it depends on:
  // turn whole-book on, delete the index, relaunch. Asking with a stale true
  // would send a whole-book question at a book the server cannot search.
  expect(isWholeBookScopeOn(book('not_enabled', true))).toBe(false);
  expect(isWholeBookScopeOn(book('failed', true))).toBe(false);
  expect(isWholeBookScopeOn(book('deleting', true))).toBe(false);
});

test('scope stays off while an index is still being built', () => {
  expect(isWholeBookScopeOn(book('indexing', true))).toBe(false);
  expect(isWholeBookScopeOn(book('uploading', true))).toBe(false);
  expect(isWholeBookScopeOn(book('queued', true))).toBe(false);
});

test('no book means no scope', () => {
  expect(isWholeBookScopeOn(null)).toBe(false);
});
