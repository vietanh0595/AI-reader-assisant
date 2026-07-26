import { flattenAnswerMarkdown } from '../components/parseAnswerMarkdown';

export type AnkiNoteAction = 'highlight' | 'explain' | 'example' | 'rephrase' | 'simpler' | 'summarize';

// `question` is display-ready — already resolved to `question || eyebrow` by the App.tsx
// adapter, the same convention ExportableNote uses. This module never touches App.tsx types.
export type AnkiSourceNote = {
  id: string;
  action: 'ask' | AnkiNoteAction;
  question: string;
  body: string;
  selectedText: string;
  userNote?: string;
};

export type AnkiCard = { front: string; back: string };

export type AnkiNoteInput = {
  noteId: string;
  action: AnkiNoteAction;
  passage?: string;
  answer?: string;
  userNote?: string;
};

export type AnkiCardResult = { noteId: string; front: string; back: string };

// An `ask` note already has a real question and answer — pure formatting, no AI, no
// network call. Everything else has either no question (quick-actions) or no answer at
// all (a bare highlight), so it needs AI to turn it into a real quiz question.
export function classifyNoteForAnkiExport(note: AnkiSourceNote): 'formatted' | 'needsAi' {
  return note.action === 'ask' ? 'formatted' : 'needsAi';
}

// Only ever called on a `needsAi`-classified note, so `note.action` here excludes 'ask'.
export function toAnkiNoteInput(note: AnkiSourceNote): AnkiNoteInput {
  return {
    noteId: note.id,
    action: note.action as AnkiNoteAction,
    passage: note.selectedText || undefined,
    answer: note.body || undefined,
    userNote: note.userNote,
  };
}

function formatAskNoteAsCard(note: AnkiSourceNote): AnkiCard | null {
  const front = note.question.trim();
  const back = flattenAnswerMarkdown(note.body).trim();
  return front && back ? { front, back } : null;
}

export function formatAnkiCardLine(front: string, back: string): string {
  return `${escapeField(front)}\t${escapeField(back)}`;
}

function escapeField(value: string): string {
  return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

export function buildAnkiFile(cards: AnkiCard[]): string {
  return cards.map((card) => formatAnkiCardLine(card.front, card.back)).join('\n');
}

// Merges the two card sources back into the notes' original order: `ask` notes formatted
// directly, everything else matched back to its AI-generated card by noteId. A noteId with
// no entry in aiResults means the model chose to skip that note — it is silently omitted,
// not an error.
export function buildCardsFromResults(notes: AnkiSourceNote[], aiResults: AnkiCardResult[]): AnkiCard[] {
  const aiByNoteId = new Map(aiResults.map((result) => [result.noteId, result]));
  const cards: AnkiCard[] = [];

  for (const note of notes) {
    if (classifyNoteForAnkiExport(note) === 'formatted') {
      const card = formatAskNoteAsCard(note);
      if (card) {
        cards.push(card);
      }
      continue;
    }

    const aiCard = aiByNoteId.get(note.id);
    if (aiCard && aiCard.front.trim() && aiCard.back.trim()) {
      cards.push({ front: aiCard.front.trim(), back: aiCard.back.trim() });
    }
  }

  return cards;
}
