import * as Crypto from 'expo-crypto';

import type { UploadBlock, DocumentSourceRef } from './types';

function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = deepSortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalSourceRef(ref: DocumentSourceRef): unknown {
  // Filter undefined, then recursively sort all nested keys so serialization is
  // stable regardless of JS insertion order or PostgreSQL JSONB key reordering.
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(ref) as (keyof DocumentSourceRef)[]) {
    if (ref[key] !== undefined) {
      filtered[key as string] = ref[key];
    }
  }
  return deepSortKeys(filtered);
}

export async function hashUploadBlock(block: UploadBlock): Promise<string> {
  const canonical = JSON.stringify([
    block.paragraphId,
    block.readingOrder,
    block.blockKind,
    block.chapterId ?? null,
    block.chapterTitle ?? null,
    canonicalSourceRef(block.sourceRef),
    block.text.trim(),
  ]);
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonical);
}

export type HashedBook = {
  blocks: UploadBlock[];
  blockCount: number;
  contentHash: string;
};

export async function hashReaderBook(book: {
  paragraphs: Array<{
    id: string;
    blockKind: UploadBlock['blockKind'];
    text: string;
    sourceRef: DocumentSourceRef;
    chapterId?: string;
    chapterTitle?: string;
  }>;
  title: string;
  author: string;
  source: string;
}): Promise<HashedBook> {
  const blocks: UploadBlock[] = book.paragraphs.map((para, i) => ({
    paragraphId: para.id,
    readingOrder: i,
    blockKind: para.blockKind,
    text: para.text,
    sourceRef: para.sourceRef,
    chapterId: para.chapterId,
    chapterTitle: para.chapterTitle,
  }));

  const blockHashes = await Promise.all(blocks.map(hashUploadBlock));
  const bookInput = `1\n${book.source}\n${blockHashes.join('\n')}`;
  const contentHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bookInput,
  );

  return { blocks, blockCount: blocks.length, contentHash };
}
