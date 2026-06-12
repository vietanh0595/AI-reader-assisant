import * as Crypto from 'expo-crypto';

import type { UploadBlock, DocumentSourceRef } from './types';

function canonicalSourceRef(ref: DocumentSourceRef): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = Object.keys(ref).sort() as (keyof DocumentSourceRef)[];
  for (const key of keys) {
    if (ref[key] !== undefined) {
      result[key as string] = ref[key];
    }
  }
  return result;
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
