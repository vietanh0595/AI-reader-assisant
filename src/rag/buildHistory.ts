import type { ConversationTurn } from '../library/conversation';

export type ApiTurn = { role: 'user' | 'assistant'; content: string };

export const DEFAULT_HISTORY_CHAR_BUDGET = 6000;

export function buildHistory(turns: ConversationTurn[], budget = DEFAULT_HISTORY_CHAR_BUDGET): ApiTurn[] {
  const kept: ApiTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turns[i].text.length;
    if (used + cost > budget && kept.length > 0) break;
    kept.unshift({ role: turns[i].role, content: turns[i].text });
    used += cost;
  }
  return kept;
}
