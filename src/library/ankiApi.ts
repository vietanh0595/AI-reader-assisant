import type { AnkiCardResult, AnkiNoteInput } from './ankiExport';

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// Must match backend/app/anki_cards.py's AnkiCardsRequest.notes max_length. A single
// request over this cap gets one all-or-nothing 422 for the whole export, which for
// this app's academic-reader audience (a single highlight is one tap) is a realistic
// failure mode above 200 eligible notes — so this splits transparently instead.
const MAX_NOTES_PER_REQUEST = 200;

export async function requestAnkiCards(
  args: { apiBaseUrl: string; notes: AnkiNoteInput[] },
  fetchImpl: FetchLike = fetch,
): Promise<AnkiCardResult[]> {
  const batches = chunk(args.notes, MAX_NOTES_PER_REQUEST);
  const results: AnkiCardResult[] = [];

  for (const batch of batches) {
    const cards = await requestAnkiCardsBatch(args.apiBaseUrl, batch, fetchImpl);
    results.push(...cards);
  }

  return results;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

async function requestAnkiCardsBatch(
  apiBaseUrl: string,
  notes: AnkiNoteInput[],
  fetchImpl: FetchLike,
): Promise<AnkiCardResult[]> {
  const url = `${apiBaseUrl}/notes/anki-cards`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });

  if (!response.ok) {
    throw new Error(`Anki card generation failed with status ${response.status}.`);
  }

  const data: unknown = await response.json();

  if (!isRecord(data) || !Array.isArray(data.cards)) {
    throw new Error('Anki cards response was not in the expected format.');
  }

  return data.cards.filter(isAnkiCardResult);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAnkiCardResult(value: unknown): value is AnkiCardResult {
  return (
    isRecord(value) &&
    typeof value.noteId === 'string' &&
    typeof value.front === 'string' &&
    typeof value.back === 'string'
  );
}
