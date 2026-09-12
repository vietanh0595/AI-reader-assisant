// Words that describe the slot rather than the picture. A book that labels every
// plate "[Illustration]" is not telling the reader — or the AI — anything.
const PLACEHOLDER = /^(\[?\s*(illustration|illus|image|img|photo|picture|figure|fig|plate|graphic|cover(\s+image)?|decoration)\s*\]?)$/i;

// "Illo1", "img_0042", "plate01_th.jpg" — a filename or an index, not a description.
const BARE_IDENTIFIER = /^[a-z]*[-_]?\d+(_[a-z0-9]+)*(\.[a-z0-9]+)?$/i;

/**
 * Whether a figure's alt text says enough to be worth indexing.
 *
 * The alt text is the only part of a figure the AI can read, which is exactly why
 * junk is worse here than nothing: an indexed "[Illustration]" is retrievable
 * evidence that carries no information, and a book with dozens of them can crowd out
 * passages that actually answer the question. A figure that fails this check still
 * renders — it simply contributes nothing to search.
 *
 * Deliberately narrow. Genuine short captions ("The White Rabbit", "Fig. 3: market
 * depth") must survive, so only exact placeholder words and bare identifiers are
 * rejected, never anything merely short.
 */
export function isMeaningfulAltText(alt: string): boolean {
  const trimmed = alt.trim();

  if (!trimmed) {
    return false;
  }

  return !PLACEHOLDER.test(trimmed) && !BARE_IDENTIFIER.test(trimmed);
}
