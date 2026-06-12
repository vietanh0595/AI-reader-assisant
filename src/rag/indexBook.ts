import type { IndexApi } from './indexApi';
import type { WholeBookAiState } from './types';
import { hashReaderBook } from './hashBook';
import { buildUploadBatches, encodeBatch } from './buildBatches';

type BookInput = {
  paragraphs: Array<{
    id: string;
    blockKind: import('./types').UploadBlock['blockKind'];
    text: string;
    sourceRef: import('./types').DocumentSourceRef;
    chapterId?: string;
    chapterTitle?: string;
  }>;
  title: string;
  author: string;
  source: 'epub' | 'pdf' | 'scan' | 'sample';
  clientBookId: string;
  fileName?: string;
};

export type IndexBookOptions = {
  api: IndexApi;
  book: BookInput;
  localState: WholeBookAiState | null;
  onProgress: (progress: number) => void;
};

export async function indexBook({
  api,
  book,
  localState,
  onProgress,
}: IndexBookOptions): Promise<WholeBookAiState> {
  const { blocks, blockCount, contentHash } = await hashReaderBook(book);

  const { bookId, versionId, reused, acknowledgedBatches } = await api.createOrResume({
    clientBookId: book.clientBookId,
    title: book.title,
    author: book.author,
    sourceType: book.source === 'sample' ? 'epub' : book.source,
    fileName: book.fileName,
    contentHash,
    blockCount,
    parserSchemaVersion: 1,
  });

  if (reused) {
    const status = await api.getStatus(bookId);
    return {
      acknowledgedBatch: -1,
      cloudBookId: bookId,
      versionId,
      contentHash,
      status: (status.status as WholeBookAiState['status']) ?? 'queued',
      progress: status.progress ?? 0,
    };
  }

  const serverAcknowledged = acknowledgedBatches ?? 0;
  const localAcknowledged =
    localState?.versionId === versionId ? localState.acknowledgedBatch + 1 : 0;
  const resumeFromSequence = Math.max(serverAcknowledged, localAcknowledged);

  const batches = buildUploadBatches(blocks);
  let lastAcknowledged = resumeFromSequence - 1;

  for (let seq = resumeFromSequence; seq < batches.length; seq++) {
    const batchBlocks = batches[seq];
    const { blob, payloadHash } = await encodeBatch(batchBlocks);

    await api.uploadBatch({
      bookId,
      versionId,
      sequence: seq,
      idempotencyKey: `${versionId}-batch-${seq}`,
      blocks: batchBlocks,
      payloadHash,
      blob,
    });

    lastAcknowledged = seq;
    onProgress((seq + 1) / batches.length * 0.9);
  }

  const commitStatus = await api.commit(bookId, versionId);

  onProgress(1);

  return {
    acknowledgedBatch: lastAcknowledged,
    cloudBookId: bookId,
    versionId,
    contentHash,
    status: (commitStatus.status as WholeBookAiState['status']) ?? 'queued',
    progress: commitStatus.progress ?? 0,
  };
}
