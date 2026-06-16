import * as Crypto from 'expo-crypto';

import type { UploadBlock } from './types';

const MIN_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 250;
const DEFAULT_TARGET_SIZE = 150;

export function buildUploadBatches(
  blocks: UploadBlock[],
  targetSize: number = DEFAULT_TARGET_SIZE,
): UploadBlock[][] {
  if (blocks.length === 0) {
    return [];
  }

  const batches: UploadBlock[][] = [];
  let offset = 0;

  while (offset < blocks.length) {
    const remaining = blocks.length - offset;

    if (remaining <= MAX_BATCH_SIZE) {
      batches.push(blocks.slice(offset));
      break;
    }

    const size = Math.min(
      Math.max(targetSize, MIN_BATCH_SIZE),
      MAX_BATCH_SIZE,
    );
    batches.push(blocks.slice(offset, offset + size));
    offset += size;
  }

  return batches;
}

export type EncodedBatch = {
  body: string;
  payloadHash: string;
  blockCount: number;
};

export async function encodeBatch(blocks: UploadBlock[]): Promise<EncodedBatch> {
  // Send uncompressed JSON: React Native cannot build a Blob from binary bytes
  // nor reliably send a raw byte body, so we use a plain string the server can
  // hash and parse directly. The hash covers the exact UTF-8 body the server reads.
  const body = JSON.stringify({ blocks });
  const payloadHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    body,
  );

  return {
    body,
    payloadHash,
    blockCount: blocks.length,
  };
}
