jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_alg: string, input: string) => {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  },
}));

import { hashReaderBook, hashUploadBlock } from './hashBook';
import type { UploadBlock } from './types';

function makeBlock(text: string, readingOrder: number): UploadBlock {
  return {
    paragraphId: `para-${readingOrder}`,
    readingOrder,
    blockKind: 'body',
    text,
    sourceRef: { source: 'epub' },
  };
}

function bookWithParagraphs(texts: string[]) {
  return {
    paragraphs: texts.map((text, i) => ({
      id: `para-${i}`,
      blockKind: 'body' as const,
      text,
      sourceRef: { source: 'epub' as const },
    })),
    title: 'Test Book',
    author: 'Test Author',
    source: 'epub' as const,
  };
}

test('book hash is stable and changes with reading order', async () => {
  const first = await hashReaderBook(bookWithParagraphs(['one', 'two']));
  const repeat = await hashReaderBook(bookWithParagraphs(['one', 'two']));
  const reordered = await hashReaderBook(bookWithParagraphs(['two', 'one']));
  expect(first.contentHash).toBe(repeat.contentHash);
  expect(first.contentHash).not.toBe(reordered.contentHash);
});

test('block hash changes with text content', async () => {
  const block1 = makeBlock('hello world', 0);
  const block2 = makeBlock('different text', 0);
  const hash1 = await hashUploadBlock(block1);
  const hash2 = await hashUploadBlock(block2);
  expect(hash1).not.toBe(hash2);
});

test('block hash changes with reading order', async () => {
  const block1 = makeBlock('same text', 0);
  const block2 = makeBlock('same text', 1);
  const hash1 = await hashUploadBlock(block1);
  const hash2 = await hashUploadBlock(block2);
  expect(hash1).not.toBe(hash2);
});

test('block hash is sensitive to source ref changes', async () => {
  const block1: UploadBlock = { ...makeBlock('text', 0), sourceRef: { source: 'epub', pageIndex: 1 } };
  const block2: UploadBlock = { ...makeBlock('text', 0), sourceRef: { source: 'epub', pageIndex: 2 } };
  const hash1 = await hashUploadBlock(block1);
  const hash2 = await hashUploadBlock(block2);
  expect(hash1).not.toBe(hash2);
});

test('book hash output is 64 character hex string', async () => {
  const result = await hashReaderBook(bookWithParagraphs(['test']));
  expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.blockCount).toBe(1);
  expect(result.blocks).toHaveLength(1);
});

test('block hash is stable regardless of boundingBox key insertion order', async () => {
  // Regression: JSONB reorders nested object keys; deepSortKeys must normalize both sides.
  const blockNativeOrder: UploadBlock = {
    ...makeBlock('PDF paragraph.', 0),
    sourceRef: {
      source: 'pdf',
      boundingBox: { y: 10, x: 5, width: 100, height: 50, unit: 'px' },
    },
  };
  const blockAlphaOrder: UploadBlock = {
    ...makeBlock('PDF paragraph.', 0),
    sourceRef: {
      source: 'pdf',
      boundingBox: { height: 50, unit: 'px', width: 100, x: 5, y: 10 },
    },
  };
  expect(await hashUploadBlock(blockNativeOrder)).toBe(await hashUploadBlock(blockAlphaOrder));
});

test('block hash uses raw Unicode, not escaped sequences', async () => {
  // Regression: ensure_ascii=False on the Python side means JS must NOT escape Unicode.
  const unicodeBlock = makeBlock('Café — 中文テスト', 0);
  const escapedBlock = makeBlock('Caf\\u00e9 \\u2014 \\u4e2d\\u6587\\u30c6\\u30b9\\u30c8', 0);
  const unicodeHash = await hashUploadBlock(unicodeBlock);
  expect(unicodeHash).toMatch(/^[a-f0-9]{64}$/);
  expect(unicodeHash).not.toBe(await hashUploadBlock(escapedBlock));
});
