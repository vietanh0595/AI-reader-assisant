jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_alg: string, input: string) => {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  },
  digest: async (_alg: string, data: Uint8Array) => {
    // TS 5.7+: Uint8Array<ArrayBufferLike> is not assignable to BufferSource directly
    return globalThis.crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  },
}));

import { buildUploadBatches, encodeBatch } from './buildBatches';
import type { UploadBlock } from './types';

function makeBlocks(count: number): UploadBlock[] {
  return Array.from({ length: count }, (_, i) => ({
    paragraphId: `para-${i}`,
    readingOrder: i,
    blockKind: 'body' as const,
    text: `Block ${i} text content.`,
    sourceRef: { source: 'epub' as const },
  }));
}

test('single batch when block count is within target', () => {
  const batches = buildUploadBatches(makeBlocks(100));
  expect(batches).toHaveLength(1);
  expect(batches[0]).toHaveLength(100);
});

test('minimum batch size is 100 except the final batch', () => {
  const batches = buildUploadBatches(makeBlocks(210));
  for (let i = 0; i < batches.length - 1; i++) {
    expect(batches[i].length).toBeGreaterThanOrEqual(100);
  }
});

test('maximum batch size is 250', () => {
  const batches = buildUploadBatches(makeBlocks(500));
  for (const batch of batches) {
    expect(batch.length).toBeLessThanOrEqual(250);
  }
});

test('all blocks are included across batches', () => {
  const blocks = makeBlocks(375);
  const batches = buildUploadBatches(blocks);
  const total = batches.reduce((sum, b) => sum + b.length, 0);
  expect(total).toBe(375);
});

test('encodeBatch returns blob, hash, and block count', async () => {
  const blocks = makeBlocks(5);
  const result = await encodeBatch(blocks);
  expect(result.blob).toBeInstanceOf(Blob);
  expect(result.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.blockCount).toBe(5);
});

test('encodeBatch gzip is decompressible', async () => {
  const blocks = makeBlocks(3);
  const result = await encodeBatch(blocks);
  const buffer = await result.blob.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { gunzipSync } = require('fflate') as typeof import('fflate');
  const decompressed = gunzipSync(new Uint8Array(buffer));
  const parsed = JSON.parse(new TextDecoder().decode(decompressed));
  expect(parsed.blocks).toHaveLength(3);
});
