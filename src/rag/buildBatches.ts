import * as Crypto from 'expo-crypto';
import { strToU8, gzipSync } from 'fflate';

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
  blob: Blob;
  payloadHash: string;
  blockCount: number;
};

export async function encodeBatch(blocks: UploadBlock[]): Promise<EncodedBatch> {
  const json = JSON.stringify({ blocks });
  const uncompressed = strToU8(json);
  const compressed = gzipSync(uncompressed);

  // Hash the compressed bytes — exactly what the server receives and verifies.
  // expo-crypto works on both Hermes (native) and browser environments.
  const hashBuf = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, compressed);
  const payloadHash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    blob: new Blob([compressed], { type: 'application/json' }),
    payloadHash,
    blockCount: blocks.length,
  };
}
