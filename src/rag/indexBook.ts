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
  const normalizedSource = book.source === 'sample' ? 'epub' : book.source;
  const { blocks, blockCount, contentHash } = await hashReaderBook({
    ...book,
    source: normalizedSource,
  });

  const { bookId, versionId, reused, acknowledgedBatches } = await api.createOrResume({
    clientBookId: book.clientBookId,
    title: book.title,
    author: book.author,
    sourceType: normalizedSource,
    fileName: book.fileName,
    contentHash,
    blockCount,
    parserSchemaVersion: 1,
  });

  if (reused) {
    const initial = await api.getStatus(bookId);
    const base: WholeBookAiState = {
      acknowledgedBatch: -1,
      cloudBookId: bookId,
      versionId,
      contentHash,
      status: (initial.status as WholeBookAiState['status']) ?? 'queued',
      progress: initial.progress ?? 0,
    };
    return pollUntilDone(api, bookId, base, onProgress);
  }

  const serverAcknowledged = acknowledgedBatches ?? 0;
  const localAcknowledged =
    localState?.versionId === versionId ? localState.acknowledgedBatch + 1 : 0;
  const resumeFromSequence = Math.max(serverAcknowledged, localAcknowledged);

  const batches = buildUploadBatches(blocks);
  let lastAcknowledged = resumeFromSequence - 1;

  for (let seq = resumeFromSequence; seq < batches.length; seq++) {
    const batchBlocks = batches[seq];
    const { body, payloadHash } = await encodeBatch(batchBlocks);

    await api.uploadBatch({
      bookId,
      versionId,
      sequence: seq,
      idempotencyKey: `${versionId}-batch-${seq}`,
      blocks: batchBlocks,
      payloadHash,
      body,
    });

    lastAcknowledged = seq;
    onProgress((seq + 1) / batches.length * 0.9);
  }

  await api.commit(bookId, versionId);

  const committed: WholeBookAiState = {
    acknowledgedBatch: lastAcknowledged,
    cloudBookId: bookId,
    versionId,
    contentHash,
    status: 'queued',
    progress: 0,
  };
  return pollUntilDone(api, bookId, committed, onProgress);
}

const _POLL_INTERVAL_MS = 3_000;
const _POLL_MAX_ATTEMPTS = 200; // 10 minutes
const _TERMINAL_STATUSES = new Set<WholeBookAiState['status']>(['ready', 'failed']);

async function pollUntilDone(
  api: IndexApi,
  bookId: string,
  state: WholeBookAiState,
  onProgress: (progress: number) => void,
): Promise<WholeBookAiState> {
  let current = state;
  let attempts = 0;
  while (!_TERMINAL_STATUSES.has(current.status)) {
    if (attempts >= _POLL_MAX_ATTEMPTS) {
      return { ...current, status: 'failed' };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, _POLL_INTERVAL_MS));
    attempts++;
    const polled = await api.getStatus(bookId);
    current = {
      ...current,
      status: (polled.status as WholeBookAiState['status']) ?? current.status,
      progress: polled.progress ?? current.progress,
      error: polled.errorMessage ?? current.error,
    };
    onProgress(current.progress);
  }
  return current;
}
