export type CoverCandidate = {
  id: string;
  mediaType: string | null;
  path: string;
  properties: string;
};

function isImage(item: CoverCandidate): boolean {
  return (item.mediaType ?? '').startsWith('image/');
}

/**
 * The path inside the EPUB of the book's cover image, or null if it declares none.
 *
 * Two spellings exist and books in the wild use either. EPUB 3 marks the manifest
 * item itself with the `cover-image` property; EPUB 2 names it by id from a
 * `<meta name="cover" content="...">` tag. The EPUB 3 form wins when both are
 * present, because it is the one the format actually specifies.
 *
 * Both routes are checked against the media type before being trusted: a pointer
 * aimed at an XHTML file would otherwise be written out as a cover and render as a
 * blank card.
 */
export function findEpubCoverPath(
  items: CoverCandidate[],
  metaCoverId?: string,
): string | null {
  const declared = items.find(
    (item) => item.properties.split(/\s+/).includes('cover-image') && isImage(item),
  );

  if (declared) {
    return declared.path;
  }

  if (metaCoverId) {
    const referenced = items.find((item) => item.id === metaCoverId && isImage(item));

    if (referenced) {
      return referenced.path;
    }
  }

  return null;
}
