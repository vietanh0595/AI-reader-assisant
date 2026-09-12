// Muted enough to sit under white text and beside real cover art without shouting.
// Tuned to the app's warm paper palette rather than picked at random.
export const COVER_CARD_COLORS = [
  '#244f38', // sage dark
  '#8f6c3d', // clay
  '#4a5568', // slate
  '#7a3b3b', // brick
  '#3f5d6b', // deep teal
  '#5d4a70', // plum
] as const;

/**
 * A background colour for a book with no cover art of its own.
 *
 * Derived from the title so it is stable: the same book is the same colour on every
 * launch and on every device. A library whose colours reshuffle each time reads as
 * broken, and stability is the whole reason not to just pick at random.
 */
export function pickCoverCardColor(title: string): string {
  // Small FNV-style accumulation. Not a real hash and does not need to be — it only
  // has to spread a handful of titles across six buckets without clustering.
  let accumulator = 0;

  for (let index = 0; index < title.length; index += 1) {
    accumulator = (accumulator * 31 + title.charCodeAt(index)) >>> 0;
  }

  return COVER_CARD_COLORS[accumulator % COVER_CARD_COLORS.length];
}
