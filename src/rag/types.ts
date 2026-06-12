export type DocumentSource = 'epub' | 'pdf' | 'sample' | 'scan';

export type DocumentSourceRef = {
  anchor?: string;
  blockId?: string;
  blockIndex?: number;
  boundingBox?: {
    height: number;
    unit: 'px' | 'ratio';
    width: number;
    x: number;
    y: number;
  };
  fileName?: string;
  href?: string;
  imageUri?: string;
  ocrConfidence?: number;
  pageIndex?: number;
  pageLabel?: string;
  source: DocumentSource;
};

export type ReaderBlockKind =
  | 'body'
  | 'chapterNumber'
  | 'chapterTitle'
  | 'sectionHeading'
  | 'subheading'
  | 'quote'
  | 'listItem';

export type UploadBlock = {
  blockKind: ReaderBlockKind;
  chapterId?: string;
  chapterTitle?: string;
  paragraphId: string;
  readingOrder: number;
  sourceRef: DocumentSourceRef;
  text: string;
};

export type WholeBookAiState = {
  acknowledgedBatch: number;
  cloudBookId?: string;
  contentHash?: string;
  error?: string;
  progress: number;
  status: 'not_enabled' | 'uploading' | 'queued' | 'indexing' | 'ready' | 'failed' | 'deleting';
  versionId?: string;
};

export type CreateIndexRequest = {
  clientBookId: string;
  title: string;
  author: string;
  sourceType: 'epub' | 'pdf' | 'scan';
  fileName?: string;
  contentHash: string;
  blockCount: number;
  parserSchemaVersion: number;
};

export type CreateIndexResponse = {
  bookId: string;
  versionId: string;
  reused: boolean;
};

export type BatchUploadResponse = {
  replayed: boolean;
  sequenceNumber: number;
  blockCount: number;
};

export type IndexStatus = {
  status: string;
  progress: number;
  errorCode?: string;
  errorMessage?: string;
  versionId?: string;
};
