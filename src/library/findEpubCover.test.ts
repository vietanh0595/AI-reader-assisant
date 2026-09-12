import { findEpubCoverPath } from './findEpubCover';

const textItem = { id: 'chap1', mediaType: 'application/xhtml+xml', path: 'OEBPS/chap1.xhtml', properties: '' };
const coverImage = { id: 'cover-img', mediaType: 'image/jpeg', path: 'OEBPS/images/cover.jpg', properties: 'cover-image' };
const plainImage = { id: 'img-7', mediaType: 'image/png', path: 'OEBPS/images/fig7.png', properties: '' };

test('finds the cover an EPUB 3 declares in its manifest', () => {
  expect(findEpubCoverPath([textItem, coverImage])).toBe('OEBPS/images/cover.jpg');
});

test('finds the cover an EPUB 2 points at from its metadata', () => {
  // Older books name the cover by id in a <meta name="cover" content="..."> tag
  // rather than marking the manifest item itself.
  expect(findEpubCoverPath([textItem, plainImage], 'img-7')).toBe('OEBPS/images/fig7.png');
});

test('prefers the manifest declaration over a metadata pointer', () => {
  expect(findEpubCoverPath([plainImage, coverImage], 'img-7')).toBe('OEBPS/images/cover.jpg');
});

test('finds nothing when the book declares no cover', () => {
  expect(findEpubCoverPath([textItem, plainImage])).toBeNull();
});

test('ignores a metadata pointer aimed at something that is not an image', () => {
  // A broken pointer at an XHTML file would otherwise be written out as a cover
  // and render as a blank card.
  expect(findEpubCoverPath([textItem], 'chap1')).toBeNull();
});

test('ignores a properties declaration on a non-image item', () => {
  const mislabelled = { ...textItem, properties: 'cover-image' };

  expect(findEpubCoverPath([mislabelled])).toBeNull();
});

test('matches cover-image among several properties', () => {
  const multi = { ...coverImage, properties: 'svg cover-image scripted' };

  expect(findEpubCoverPath([multi])).toBe('OEBPS/images/cover.jpg');
});
