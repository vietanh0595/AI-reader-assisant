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
