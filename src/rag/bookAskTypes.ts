import type { DocumentSourceRef } from './types';

export type BookSource = {
  id: string;
  chapterTitle?: string;
  excerpt: string;
  pageIndex?: number;
  pageLabel?: string;
  paragraphId: string;
  sourceRef: DocumentSourceRef;
};

export type BookAskRequest = {
  question: string;
  currentParagraphId: string;
  currentReadingOrder: number;
  currentChapterId?: string;
  includeWholeBook: boolean;
  history?: { role: 'user' | 'assistant'; content: string }[];
  selectedText?: string;
};

export type BookAskResponse = {
  requestId: string;
  eyebrow: string;
  body: string;
  supported: boolean;
  sources: BookSource[];
};
