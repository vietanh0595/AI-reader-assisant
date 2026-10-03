import type { WholeBookAiState } from './types';

export type WholeBookAiBlocker = 'none' | 'not_indexed' | 'signed_out';

/**
 * What, if anything, stands between the reader and asking this book.
 *
 * Deliberately two answers rather than one boolean. These were a single check —
 * `status === 'ready' && isAuthenticated` — and every caller responded by opening
 * the Whole-Book AI sheet. That sheet renders from the book's own status, so an
 * expired session on an indexed book produced a sheet saying "Whole-Book AI is
 * ready. Start asking", whose button only closes it. Tap, sheet, close, tap: a loop
 * with no way out, caused by answering the wrong question.
 *
 * Signing out is reported first even for an unindexed book, because indexing needs
 * an account too — sending them to the sheet would strand them in the same way.
 */
export function wholeBookAiBlocker({
  status,
  isAuthenticated,
}: {
  status: WholeBookAiState['status'];
  isAuthenticated: boolean;
}): WholeBookAiBlocker {
  if (!isAuthenticated) {
    return 'signed_out';
  }

  return status === 'ready' ? 'none' : 'not_indexed';
}
