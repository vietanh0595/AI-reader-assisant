import type { WholeBookAiState } from '../rag/types';

export type WholeBookScopeItem = {
  includeWholeBook?: boolean;
  wholeBookAi: WholeBookAiState;
};

/**
 * Whether "Whole book" is on for this book.
 *
 * The choice is stored on the library item rather than in component state, so it
 * survives a force-quit — a toggle that forgets itself every launch reads as broken.
 * Storing it per book also means switching books picks up that book's own setting
 * instead of needing a manual reset at every book-change site.
 *
 * The stored flag is a preference, not a capability: it is only honoured while the
 * book's index is actually ready, because a persisted flag can outlive the index it
 * depends on.
 */
export function isWholeBookScopeOn(item: WholeBookScopeItem | null | undefined): boolean {
  return item?.includeWholeBook === true && item.wholeBookAi.status === 'ready';
}
