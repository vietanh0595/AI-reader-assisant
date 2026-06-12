import { createBookAskApi } from './bookAskApi';
import type { BookAskRequest } from './bookAskTypes';

function fakeClient() {
  let lastBody: unknown = null;

  const fetch = jest.fn(async (_path: string, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : null;
    return {
      ok: true,
      json: async () => ({
        requestId: 'test-id',
        eyebrow: 'Book answer',
        body: 'The answer.',
        supported: true,
        sources: [],
      }),
    } as Response;
  });

  return { client: { fetch }, getLastBody: () => lastBody };
}

test('sends book-so-far by default', async () => {
  const { client, getLastBody } = fakeClient();
  const api = createBookAskApi(client);
  await api.ask('book-1', {
    currentChapterId: 'chapter-2',
    currentParagraphId: 'p40',
    currentReadingOrder: 40,
    includeWholeBook: false,
    question: 'What causes inflation here?',
  });
  expect(getLastBody()).toEqual(
    expect.objectContaining({ includeWholeBook: false }),
  );
});

test('sends include whole book when true', async () => {
  const { client, getLastBody } = fakeClient();
  const api = createBookAskApi(client);
  await api.ask('book-1', {
    currentParagraphId: 'p10',
    currentReadingOrder: 10,
    includeWholeBook: true,
    question: 'What is the theme?',
  });
  expect(getLastBody()).toEqual(
    expect.objectContaining({ includeWholeBook: true }),
  );
});

test('sends correct endpoint path', async () => {
  const { client } = fakeClient();
  const api = createBookAskApi(client);
  await api.ask('book-42', {
    currentParagraphId: 'p1',
    currentReadingOrder: 1,
    includeWholeBook: false,
    question: 'Test?',
  });
  const fetchMock = client.fetch as jest.Mock;
  expect(fetchMock.mock.calls[0][0]).toBe('/library/books/book-42/ask');
});

test('returns structured response', async () => {
  const { client } = fakeClient();
  const api = createBookAskApi(client);
  const result = await api.ask('book-1', {
    currentParagraphId: 'p1',
    currentReadingOrder: 1,
    includeWholeBook: false,
    question: 'Test?',
  });
  expect(result.requestId).toBe('test-id');
  expect(result.supported).toBe(true);
});
