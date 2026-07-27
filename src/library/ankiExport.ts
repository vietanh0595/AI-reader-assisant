import { flattenAnswerMarkdown } from '../components/parseAnswerMarkdown';

export type AnkiNoteAction = 'ask' | 'highlight' | 'explain' | 'example' | 'rephrase' | 'simpler' | 'summarize';

// `question` is display-ready — already resolved to `question || eyebrow` by the App.tsx
// adapter, the same convention ExportableNote uses. This module never touches App.tsx types.
export type AnkiSourceNote = {
  id: string;
  action: AnkiNoteAction;
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
  // Only sent for an 'ask' note with a selection (see classifyNoteForAnkiExport) — the
  // reader's own, possibly-vague question ("give me an example"), so the backend can
  // decide whether to keep it or rewrite it into something self-contained.
  question?: string;
  userNote?: string;
};

export type AnkiExportClassification = 'formatted' | 'needsAiFront' | 'needsAiFull';

export type AnkiCardResult = { noteId: string; front: string; back: string };

// Must match backend/app/anki_cards.py's AnkiNoteInput max_length constraints exactly,
// so an oversized field is truncated client-side instead of 422ing its whole batch.
const MAX_PASSAGE_OR_ANSWER_LENGTH = 4000;
const MAX_USER_NOTE_LENGTH = 2000;

// An `ask` note already has a real question and answer. If it has no selection, the
// question was either substantive already or already composed with context by
// composeNoteQuestion (e.g. "529 Plan — example") — pure formatting, no AI, no network
// call. If it DOES have a selection, the question may be a vague follow-up ("give me an
// example") that composeNoteQuestion deliberately left un-prefixed on the theory that
// "the passage travels with the note" — true in the app's own UI, false on an Anki card,
// which is just front/back. That case needs AI to judge the question and rewrite it if
// needed, using the passage as context — but the back stays the original answer;
// see buildCardsFromResults. Everything else (highlight/quick-actions) has no question at
// all, or no answer at all, so it needs AI to write both from scratch.
export function classifyNoteForAnkiExport(note: AnkiSourceNote): AnkiExportClassification {
  if (note.action !== 'ask') {
    return 'needsAiFull';
  }
  return note.selectedText ? 'needsAiFront' : 'formatted';
}

// Called on any non-'formatted' note. `question` is only included for an 'ask' note (the
// only action with a real reader-asked question) — other actions' AnkiSourceNote.question
// is just the AI's own eyebrow label, not something to hand back to the model as if it
// were a question.
export function toAnkiNoteInput(note: AnkiSourceNote): AnkiNoteInput {
  return {
    noteId: note.id,
    action: note.action,
    passage: truncate(note.selectedText, MAX_PASSAGE_OR_ANSWER_LENGTH) || undefined,
    answer: truncate(note.body, MAX_PASSAGE_OR_ANSWER_LENGTH) || undefined,
    question: note.action === 'ask' ? note.question || undefined : undefined,
    userNote: truncate(note.userNote, MAX_USER_NOTE_LENGTH),
  };
}

function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return value;
  }
  return value.length > maxLength ? value.slice(0, maxLength) : value;
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

// Merges the AI-generated cards back into the notes' original order.
export function buildCardsFromResults(notes: AnkiSourceNote[], aiResults: AnkiCardResult[]): AnkiCard[] {
  const aiByNoteId = new Map(aiResults.map((result) => [result.noteId, result]));
  const cards: AnkiCard[] = [];

  for (const note of notes) {
    const classification = classifyNoteForAnkiExport(note);

    if (classification === 'formatted') {
      const card = formatAskNoteAsCard(note);
      if (card) {
        cards.push(card);
      }
      continue;
    }

    const aiCard = aiByNoteId.get(note.id);

    if (classification === 'needsAiFront') {
      // The model may keep the original question or rewrite it — either way, only the
      // front comes from it. The back is always the note's own original answer, never
      // the model's rewrite, so a citation-grounded Ask-thread answer can't drift. If the
      // model omitted this note entirely, fall back to the original question rather than
      // losing a note that already has a perfectly usable (if unpolished) answer.
      const front = (aiCard?.front.trim() || note.question.trim());
      const back = flattenAnswerMarkdown(note.body).trim();
      if (front && back) {
        cards.push({ front, back });
      }
      continue;
    }

    // needsAiFull: a noteId with no entry in aiResults means the model chose to skip
    // that note — it is silently omitted, not an error.
    if (aiCard && aiCard.front.trim() && aiCard.back.trim()) {
      cards.push({ front: aiCard.front.trim(), back: aiCard.back.trim() });
    }
  }

  return cards;
}
