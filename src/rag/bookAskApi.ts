import type { BookAskRequest, BookAskResponse } from './bookAskTypes';

type ApiClient = {
  fetch(path: string, init?: RequestInit): Promise<Response>;
};

export type BookAskApi = {
  ask(bookId: string, request: BookAskRequest): Promise<BookAskResponse>;
};

export function createBookAskApi(client: ApiClient): BookAskApi {
  return {
    async ask(bookId, request) {
      const response = await client.fetch(`/library/books/${bookId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: request.question,
          currentParagraphId: request.currentParagraphId,
          currentReadingOrder: request.currentReadingOrder,
          currentChapterId: request.currentChapterId,
          includeWholeBook: request.includeWholeBook,
          history: request.history,
          selectedText: request.selectedText,
        }),
      });

      if (!response.ok) {
        throw new Error(`Book ask failed: ${response.status}`);
      }

      return response.json() as Promise<BookAskResponse>;
    },
  };
}

export type RequestBookAskArgs = {
  apiBaseUrl: string;
  cloudBookId: string;
  question: string;
  currentParagraphId: string;
  currentReadingOrder: number;
  includeWholeBook: boolean;
  accessToken: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  selectedText?: string;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function requestBookAsk(
  args: RequestBookAskArgs,
  fetchImpl: FetchLike = fetch,
): Promise<{ eyebrow: string; body: string; sources: import('./bookAskTypes').BookSource[] }> {
  const {
    apiBaseUrl,
    cloudBookId,
    question,
    currentParagraphId,
    currentReadingOrder,
    includeWholeBook,
    accessToken,
    history,
    selectedText,
  } = args;

  const url = `${apiBaseUrl}/library/books/${cloudBookId}/ask`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question,
      currentParagraphId,
      currentReadingOrder,
      includeWholeBook,
      history,
      selectedText,
    }),
  });

  if (!response.ok) {
    throw new Error(`Book ask failed with status ${response.status}.`);
  }

  const data: unknown = await response.json();

  if (
    !isRecord(data) ||
    typeof data.eyebrow !== 'string' ||
    typeof data.body !== 'string'
  ) {
    throw new Error('Book ask response was not in the expected format.');
  }

  const sources = Array.isArray(data.sources)
    ? (data.sources as import('./bookAskTypes').BookSource[])
    : [];

  return {
    body: (data.body as string).trim(),
    eyebrow: (data.eyebrow as string).trim(),
    sources,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
