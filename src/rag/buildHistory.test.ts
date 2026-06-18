import { buildHistory } from './buildHistory';
import type { ConversationTurn } from '../library/conversation';

const turn = (role: 'user' | 'assistant', text: string): ConversationTurn =>
  ({ id: Math.random().toString(), role, text, createdAt: 'now' });

test('maps turns to {role, content}', () => {
  const out = buildHistory([turn('user', 'q'), turn('assistant', 'a')], 10_000);
  expect(out).toEqual([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]);
});

test('drops oldest whole turns to stay within the char budget', () => {
  const turns = [turn('user', 'A'.repeat(100)), turn('assistant', 'B'.repeat(100)), turn('user', 'C'.repeat(100))];
  const out = buildHistory(turns, 150); // only the last turn fits
  expect(out).toEqual([{ role: 'user', content: 'C'.repeat(100) }]);
});
