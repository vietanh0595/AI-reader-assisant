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
        }),
      });

      if (!response.ok) {
        throw new Error(`Book ask failed: ${response.status}`);
      }

      return response.json() as Promise<BookAskResponse>;
    },
  };
}
