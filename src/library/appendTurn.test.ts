import { appendTurns } from './appendTurn';

test('appends a user question then an assistant answer with sources', () => {
  let convo = appendTurns([], { role: 'user', text: 'q' });
  convo = appendTurns(convo, { role: 'assistant', text: 'a', sources: [{ id: 's0-0' } as any] });
  expect(convo.map((t) => t.role)).toEqual(['user', 'assistant']);
  expect(convo[1].sources).toHaveLength(1);
  expect(new Set(convo.map((t) => t.id)).size).toBe(2); // unique ids
});
