import type { ConversationTurn } from './conversation';

export function appendTurns(
  convo: ConversationTurn[],
  ...turns: Array<Pick<ConversationTurn, 'role' | 'text'> & Partial<ConversationTurn>>
): ConversationTurn[] {
  const made = turns.map((t, i) => ({
    id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    sources: t.sources,
    role: t.role,
    text: t.text,
  }));
  return [...convo, ...made];
}
