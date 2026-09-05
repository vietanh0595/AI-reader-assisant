export type DeletableBook = {
  book: { title: string };
  savedInsights: unknown[];
  wholeBookAi: { cloudBookId?: string };
};

export type DeleteBookPrompt = {
  title: string;
  message: string;
  confirmLabel: string;
};

/**
 * The wording for the "are you sure" before a book is deleted.
 *
 * Deleting a book is instant and permanent, and it takes the reader's own notes and
 * highlights with it — so the prompt names what is actually about to be lost rather
 * than asking a generic "are you sure?". A reader who has 40 notes in a book deserves
 * to see the number before they tap through.
 */
export function buildDeleteBookPrompt(item: DeletableBook): DeleteBookPrompt {
  const noteCount = item.savedInsights.length;
  const sentences: string[] = [];

  sentences.push(
    noteCount > 0
      ? `This removes the book and its ${noteCount} saved ${noteCount === 1 ? 'note' : 'notes'} from this device.`
      : 'This removes the book from this device.',
  );

  // Only books with Whole-Book AI switched on have a server copy, and deleting the
  // book is currently the only way to remove it — so say so, rather than leaving the
  // reader to wonder whether anything is left behind.
  if (item.wholeBookAi.cloudBookId) {
    sentences.push('Its uploaded copy and mind maps are deleted from the server too.');
  }

  sentences.push("This can't be undone.");

  return {
    title: `Delete "${item.book.title}"?`,
    message: sentences.join(' '),
    confirmLabel: 'Delete',
  };
}
