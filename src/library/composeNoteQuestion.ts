import type { ConversationTurn } from './conversation';

const MIN_SUBSTANTIVE_WORDS = 5;
const MIN_SUBSTANTIVE_CHARS = 30;
const MAX_SUBJECT_CHARS = 60;
// Templated questions are authored with straight quotes, but text can arrive curly.
const QUOTED_SUBJECT = /["“]([^"”]+)["”]/;

// A bare follow-up ("example", "why", "more") is meaningless once lifted out of the
// thread it was asked in. Resolve it against the conversation so a saved note stands
// on its own — no AI call, so this costs nothing and can't fail at save time.
export function composeNoteQuestion(
  conversation: ConversationTurn[],
  answerTurn: ConversationTurn,
): string {
  const askedIndex = conversation.findIndex((candidate) => candidate.id === answerTurn.id) - 1;
  const askedTurn = askedIndex >= 0 ? conversation[askedIndex] : null;

  if (!askedTurn || askedTurn.role !== 'user') {
    return '';
  }

  const question = askedTurn.text.trim();

  // A selection is its own context, so a short question like "Explain this passage"
  // needs no composing — the passage travels with the note.
  if (askedTurn.selectedText || isSubstantiveQuestion(question)) {
    return question;
  }

  const subject = findSubject(conversation, askedIndex);

  return subject ? `${subject} — ${question}` : question;
}

export function isSubstantiveQuestion(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed === '') {
    return false;
  }

  return (
    trimmed.split(/\s+/).length >= MIN_SUBSTANTIVE_WORDS || trimmed.length >= MIN_SUBSTANTIVE_CHARS
  );
}

function findSubject(conversation: ConversationTurn[], askedIndex: number): string {
  for (let index = askedIndex - 1; index >= 0; index -= 1) {
    const candidate = conversation[index];

    if (candidate.role !== 'user' || !isSubstantiveQuestion(candidate.text)) {
      continue;
    }

    const quoted = candidate.text.match(QUOTED_SUBJECT);

    if (quoted) {
      return quoted[1].trim();
    }

    const trimmed = candidate.text.trim();

    return trimmed.length > MAX_SUBJECT_CHARS
      ? `${trimmed.slice(0, MAX_SUBJECT_CHARS + 2).trimEnd()}…`
      : trimmed;
  }

  return '';
}
