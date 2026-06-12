import type { CreateIndexRequest, CreateIndexResponse, BatchUploadResponse, IndexStatus } from './types';
import type { UploadBlock } from './types';

export type UploadBatchRequest = {
  bookId: string;
  versionId: string;
  sequence: number;
  idempotencyKey: string;
  blocks: UploadBlock[];
  payloadHash: string;
  blob: Blob;
};

export type IndexApi = {
  createOrResume(request: CreateIndexRequest): Promise<CreateIndexResponse>;
  uploadBatch(request: UploadBatchRequest): Promise<BatchUploadResponse>;
  commit(bookId: string, versionId: string): Promise<IndexStatus>;
  getStatus(bookId: string): Promise<IndexStatus>;
  retry(bookId: string, versionId: string): Promise<IndexStatus>;
  deleteIndex(bookId: string): Promise<void>;
};

export type ApiClient = {
  fetch(path: string, init?: RequestInit): Promise<Response>;
};

export function createIndexApi(client: ApiClient): IndexApi {
  return {
    async createOrResume(request) {
      const res = await client.fetch('/library/books/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientBookId: request.clientBookId,
          title: request.title,
          author: request.author,
          sourceType: request.sourceType,
          fileName: request.fileName,
          contentHash: request.contentHash,
          blockCount: request.blockCount,
          parserSchemaVersion: request.parserSchemaVersion,
        }),
      });
      if (!res.ok) {
        throw new Error(`createOrResume failed: ${res.status}`);
      }
      const data = await res.json();
      return {
        bookId: data.bookId,
        versionId: data.versionId,
        reused: data.reused,
        acknowledgedBatches: data.acknowledgedBatches ?? 0,
      };
    },

    async uploadBatch({ bookId, versionId, sequence, idempotencyKey, blob, payloadHash }) {
      const res = await client.fetch(
        `/library/books/${bookId}/index/versions/${versionId}/batches/${sequence}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
            'Idempotency-Key': idempotencyKey,
            'X-Payload-SHA256': payloadHash,
          },
          body: blob,
        },
      );
      if (!res.ok) {
        throw new Error(`uploadBatch ${sequence} failed: ${res.status}`);
      }
      const data = await res.json();
      return {
        replayed: data.replayed,
        sequenceNumber: data.sequenceNumber,
        blockCount: data.blockCount,
      };
    },

    async commit(bookId, versionId) {
      const res = await client.fetch(
        `/library/books/${bookId}/index/versions/${versionId}/commit`,
        { method: 'POST' },
      );
      if (!res.ok) {
        throw new Error(`commit failed: ${res.status}`);
      }
      return res.json();
    },

    async getStatus(bookId) {
      const res = await client.fetch(`/library/books/${bookId}/index/status`);
      if (!res.ok) {
        throw new Error(`getStatus failed: ${res.status}`);
      }
      return res.json();
    },

    async retry(bookId, versionId) {
      const res = await client.fetch(
        `/library/books/${bookId}/index/versions/${versionId}/retry`,
        { method: 'POST' },
      );
      if (!res.ok) {
        throw new Error(`retry failed: ${res.status}`);
      }
      return res.json();
    },

    async deleteIndex(bookId) {
      const res = await client.fetch(`/library/books/${bookId}/index`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`deleteIndex failed: ${res.status}`);
      }
    },
  };
}
