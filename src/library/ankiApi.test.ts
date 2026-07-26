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

test('splits more than 200 notes into batches of at most 200', async () => {
  const notes: AnkiNoteInput[] = Array.from({ length: 250 }, (_, i) => ({
    noteId: `n${i}`,
    action: 'highlight',
    passage: 'A passage.',
  }));

  const calls: { url: string; body: { notes: AnkiNoteInput[] } }[] = [];
  const fakeFetch = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as { notes: AnkiNoteInput[] };
    calls.push({ url, body });
    return { ok: true, status: 200, json: async () => ({ cards: [] }) };
  };

  await requestAnkiCards({ apiBaseUrl: 'http://x', notes }, fakeFetch);

  expect(calls).toHaveLength(2);
  expect(calls[0].body.notes).toHaveLength(200);
  expect(calls[1].body.notes).toHaveLength(50);
});

test('concatenates results from multiple batches in order', async () => {
  const notes: AnkiNoteInput[] = Array.from({ length: 250 }, (_, i) => ({
    noteId: `n${i}`,
    action: 'highlight',
    passage: 'A passage.',
  }));

  let callCount = 0;
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as { notes: AnkiNoteInput[] };
    callCount += 1;
    const batchIndex = callCount;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        cards: body.notes.map((n) => ({ noteId: n.noteId, front: `Q${batchIndex}`, back: `A${batchIndex}` })),
      }),
    };
  };

  const cards = await requestAnkiCards({ apiBaseUrl: 'http://x', notes }, fakeFetch);

  expect(cards).toHaveLength(250);
  expect(cards.slice(0, 200).every((c) => c.front === 'Q1')).toBe(true);
  expect(cards.slice(200).every((c) => c.front === 'Q2')).toBe(true);
  expect(cards.map((c) => c.noteId)).toEqual(notes.map((n) => n.noteId));
});
