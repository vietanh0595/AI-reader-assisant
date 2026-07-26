import type { AnkiCardResult, AnkiNoteInput } from './ankiExport';

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function requestAnkiCards(
  args: { apiBaseUrl: string; notes: AnkiNoteInput[] },
  fetchImpl: FetchLike = fetch,
): Promise<AnkiCardResult[]> {
  const url = `${args.apiBaseUrl}/notes/anki-cards`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: args.notes }),
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
