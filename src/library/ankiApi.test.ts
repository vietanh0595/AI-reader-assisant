import { requestAnkiCards } from './ankiApi';
import type { AnkiNoteInput } from './ankiExport';

const note: AnkiNoteInput = { noteId: 'n1', action: 'highlight', passage: 'A passage.' };

test('posts to the anki-cards endpoint with the notes payload', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fakeFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    return { ok: true, status: 200, json: async () => ({ cards: [] }) };
  };

  await requestAnkiCards({ apiBaseUrl: 'http://x', notes: [note] }, fakeFetch);

  expect(calls[0].url).toBe('http://x/notes/anki-cards');
  expect(calls[0].body).toEqual({ notes: [note] });
});

test('returns the cards from a successful response', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ cards: [{ noteId: 'n1', front: 'Q', back: 'A' }] }),
  });

  const cards = await requestAnkiCards({ apiBaseUrl: 'http://x', notes: [note] }, fakeFetch);

  expect(cards).toEqual([{ noteId: 'n1', front: 'Q', back: 'A' }]);
});

test('throws on a non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

  await expect(requestAnkiCards({ apiBaseUrl: 'http://x', notes: [note] }, fakeFetch)).rejects.toThrow(
    'Anki card generation failed with status 500.',
  );
});

test('ignores a malformed card entry rather than throwing', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ cards: [{ noteId: 'n1', front: 'Q', back: 'A' }, { noteId: 'n2' }] }),
  });

  const cards = await requestAnkiCards({ apiBaseUrl: 'http://x', notes: [note] }, fakeFetch);

  expect(cards).toEqual([{ noteId: 'n1', front: 'Q', back: 'A' }]);
});
