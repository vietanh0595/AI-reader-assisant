import type { IndexApi, UploadBatchRequest } from './indexApi';
import type { CreateIndexRequest, CreateIndexResponse, BatchUploadResponse, IndexStatus } from './types';
import { indexBook } from './indexBook';
import type { UploadBlock } from './types';

function makeBlocks(count: number): UploadBlock[] {
  return Array.from({ length: count }, (_, i) => ({
    paragraphId: `para-${i}`,
    readingOrder: i,
    blockKind: 'body' as const,
    text: `Block ${i} text.`,
    sourceRef: { source: 'epub' as const },
  }));
}

function testBook(blockCount: number) {
  return {
    paragraphs: makeBlocks(blockCount).map((b) => ({
      id: b.paragraphId,
      blockKind: b.blockKind,
      text: b.text,
      sourceRef: b.sourceRef,
    })),
    title: 'Test Book',
    author: 'Test Author',
    source: 'epub' as const,
    clientBookId: 'client-book-1',
    fileName: 'test.epub',
  };
}

function fakeIndexApi(opts: {
  highestAcknowledgedBatch?: number;
  reused?: boolean;
  versionId?: string;
} = {}): IndexApi & {
  createOrResume: jest.Mock;
  uploadBatch: jest.Mock;
  commit: jest.Mock;
  getStatus: jest.Mock;
  retry: jest.Mock;
  deleteIndex: jest.Mock;
} {
  const versionId = opts.versionId ?? 'ver-1';
  const bookId = 'book-1';
  const highestAcknowledged = opts.highestAcknowledgedBatch ?? -1;

  const createOrResume = jest.fn(async (_req: CreateIndexRequest): Promise<CreateIndexResponse> => ({
    bookId,
    versionId,
    reused: opts.reused ?? false,
    acknowledgedBatches: highestAcknowledged + 1,
  }));

  const uploadBatch = jest.fn(
    async (request: UploadBatchRequest): Promise<BatchUploadResponse> => ({
      replayed: request.sequence <= highestAcknowledged,
      sequenceNumber: request.sequence,
      blockCount: request.blocks.length,
    }),
  );

  const commit = jest.fn(async (_bookId: string, _versionId: string): Promise<IndexStatus> => ({
    status: 'queued',
    progress: 0,
    versionId,
  }));

  const getStatus = jest.fn(async (_bookId: string): Promise<IndexStatus> => ({
    status: 'ready',
    progress: 1,
    versionId,
  }));

  const retry = jest.fn(async (_bookId: string, _versionId: string): Promise<IndexStatus> => ({
    status: 'queued',
    progress: 0,
    versionId,
  }));

  const deleteIndex = jest.fn(async (_bookId: string): Promise<void> => {});

  return { createOrResume, uploadBatch, commit, getStatus, retry, deleteIndex };
}

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

test('uploads all batches and commits when starting fresh', async () => {
  const api = fakeIndexApi();
  const onProgress = jest.fn();
  const book = testBook(200);

  const result = await indexBook({ api, book, localState: null, onProgress });

  expect(api.createOrResume).toHaveBeenCalledTimes(1);
  expect(api.uploadBatch.mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(api.commit).toHaveBeenCalledTimes(1);
  // indexBook polls until terminal status; mock getStatus returns 'ready' immediately
  expect(result.status).toBe('ready');
  expect(result.cloudBookId).toBe('book-1');
  expect(result.versionId).toBe('ver-1');
});

test('resumes after the highest acknowledged batch', async () => {
  const api = fakeIndexApi({ highestAcknowledgedBatch: 1 });
  const book = testBook(450);

  await indexBook({ api, book, localState: null, onProgress: jest.fn() });

  const uploadedSequences = api.uploadBatch.mock.calls.map(
    ([request]) => (request as UploadBatchRequest).sequence,
  );
  expect(uploadedSequences).not.toContain(0);
  expect(uploadedSequences).not.toContain(1);
  expect(uploadedSequences[0]).toBe(2);
  expect(api.commit).toHaveBeenCalledTimes(1);
});

test('skips upload when reused and goes straight to queued/ready status', async () => {
  const api = fakeIndexApi({ reused: true });

  const result = await indexBook({ api, book: testBook(100), localState: null, onProgress: jest.fn() });

  expect(api.uploadBatch).not.toHaveBeenCalled();
  expect(api.commit).not.toHaveBeenCalled();
  expect(result.status).toBe('ready');
});

test('calls onProgress during upload', async () => {
  const api = fakeIndexApi();
  const onProgress = jest.fn();

  await indexBook({ api, book: testBook(300), localState: null, onProgress });

  expect(onProgress.mock.calls.length).toBeGreaterThan(0);
  const [lastCall] = onProgress.mock.calls[onProgress.mock.calls.length - 1];
  expect(lastCall).toBeGreaterThan(0);
  expect(lastCall).toBeLessThanOrEqual(1);
});

test('uses persisted localState to skip already acknowledged batches', async () => {
  const api = fakeIndexApi({ highestAcknowledgedBatch: 0 });
  const book = testBook(200);

  await indexBook({
    api,
    book,
    localState: {
      acknowledgedBatch: 0,
      cloudBookId: 'book-1',
      versionId: 'ver-1',
      contentHash: 'any',
      status: 'uploading',
      progress: 0.5,
    },
    onProgress: jest.fn(),
  });

  const uploadedSequences = api.uploadBatch.mock.calls.map(
    ([r]) => (r as UploadBatchRequest).sequence,
  );
  expect(uploadedSequences).not.toContain(0);
});
