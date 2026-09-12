jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: async () => '',
  EncodingType: { Base64: 'base64' },
}));

import { extractContentBlocks } from './epub';

const body = (inner: string) => `<html><body>${inner}</body></html>`;

test('keeps an image that sits alone in a div', () => {
  // Peter Rabbit's shape. The block scanner only looks at p/h/li/blockquote, so
  // this image was previously invisible to it.
  const blocks = extractContentBlocks(
    body('<div class="fig"><img alt="[Illustration]" src="peter04.jpg"/></div>'),
  );

  expect(blocks.map((block) => block.image?.src)).toEqual(['peter04.jpg']);
});

test('keeps an image wrapped in a paragraph and a link', () => {
  // Alice's shape. The paragraph was matched and then discarded for having no
  // text, taking the image with it.
  const blocks = extractContentBlocks(
    body('<p class="figcenter"><a href="x.html"><img alt="Alice and the Duchess." src="plate01.jpg"/></a></p>'),
  );

  expect(blocks.map((block) => block.image?.src)).toEqual(['plate01.jpg']);
});

test('carries the alt text so a figure is not a blind spot', () => {
  const blocks = extractContentBlocks(
    body('<p><img alt="Alice and the Duchess." src="plate01.jpg"/></p>'),
  );

  expect(blocks[0].image?.alt).toBe('Alice and the Duchess.');
  expect(blocks[0].blockKind).toBe('image');
});

test('keeps images in reading order among the text', () => {
  const blocks = extractContentBlocks(
    body(
      '<p>Alice was beginning to get very tired of sitting by her sister.</p>'
        + '<div class="fig"><img alt="" src="rabbit.jpg"/></div>'
        + '<p>So she was considering in her own mind whether the daisy chain.</p>',
    ),
  );

  expect(blocks.map((block) => block.image?.src ?? 'text')).toEqual([
    'text',
    'rabbit.jpg',
    'text',
  ]);
});

test('ignores an image with no source', () => {
  const blocks = extractContentBlocks(body('<div><img alt="broken"/></div>'));

  expect(blocks).toEqual([]);
});

test('a short caption after a figure is kept, not discarded as noise', () => {
  // Text blocks under 12 characters are normally dropped as layout debris, which
  // would silently delete a caption like "Fig. 3".
  const blocks = extractContentBlocks(
    body('<p class="figcenter"><img alt="" src="plate01.jpg"/></p><p class="caption">Fig. 3</p>'),
  );

  expect(blocks.map((block) => block.image?.src ?? block.text)).toEqual([
    'plate01.jpg',
    'Fig. 3',
  ]);
});
