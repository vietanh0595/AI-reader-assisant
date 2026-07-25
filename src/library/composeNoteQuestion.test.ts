import type { ConversationTurn } from './conversation';
import { composeNoteQuestion, isSubstantiveQuestion } from './composeNoteQuestion';

const turn = (
  over: Partial<ConversationTurn> & Pick<ConversationTurn, 'id' | 'role' | 'text'>,
): ConversationTurn => ({ createdAt: 'now', ...over });

describe('isSubstantiveQuestion', () => {
  test('a one-word follow-up is not substantive', () => {
    expect(isSubstantiveQuestion('example')).toBe(false);
  });

  test('a five-word question is substantive', () => {
    expect(isSubstantiveQuestion('what does this term actually mean')).toBe(true);
  });

  test('a long four-word question is substantive on length', () => {
    expect(isSubstantiveQuestion('compare diversification versus concentration strategies')).toBe(true);
  });

  test('whitespace-only is not substantive', () => {
    expect(isSubstantiveQuestion('   ')).toBe(false);
  });
});

describe('composeNoteQuestion', () => {
  test('composes a bare follow-up from a quoted subject two turns back', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'Tell me more about "529 Plan", as discussed in this book and beyond.' }),
      turn({ id: 'a1', role: 'assistant', text: 'A 529 plan is...' }),
      turn({ id: 'u2', role: 'user', text: 'example' }),
      turn({ id: 'a2', role: 'assistant', text: 'Here are two examples...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[3])).toBe('529 Plan — example');
  });

  test('treats curly quotes the same as straight quotes', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'Tell me more about “529 Plan”, as discussed in this book.' }),
      turn({ id: 'a1', role: 'assistant', text: 'A 529 plan is...' }),
      turn({ id: 'u2', role: 'user', text: 'example' }),
      turn({ id: 'a2', role: 'assistant', text: 'Here are two examples...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[3])).toBe('529 Plan — example');
  });

  test('passes a substantive question through verbatim', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'How do prepaid tuition plans differ from savings plans?' }),
      turn({ id: 'a1', role: 'assistant', text: 'They differ in...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[1])).toBe(
      'How do prepaid tuition plans differ from savings plans?',
    );
  });

  test('passes a short question through verbatim when it had a selection', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'Explain this passage', selectedText: 'The most basic premise' }),
      turn({ id: 'a1', role: 'assistant', text: 'This means...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[1])).toBe('Explain this passage');
  });

  test('trims an unquoted subject to 60 characters with an ellipsis', () => {
    const long = 'Walk me through every single detail of how compound interest works over decades';
    const conversation = [
      turn({ id: 'u1', role: 'user', text: long }),
      turn({ id: 'a1', role: 'assistant', text: 'Compound interest...' }),
      turn({ id: 'u2', role: 'user', text: 'more' }),
      turn({ id: 'a2', role: 'assistant', text: 'Additionally...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[3])).toBe(
      'Walk me through every single detail of how compound interest w… — more',
    );
  });

  test('returns the follow-up alone when there is no earlier substantive turn', () => {
    const conversation = [
      turn({ id: 'u1', role: 'user', text: 'example' }),
      turn({ id: 'a1', role: 'assistant', text: 'Here is one...' }),
    ];
    expect(composeNoteQuestion(conversation, conversation[1])).toBe('example');
  });

  test('returns an empty string when the answer has no preceding user turn', () => {
    const conversation = [turn({ id: 'a1', role: 'assistant', text: 'Orphan answer' })];
    expect(composeNoteQuestion(conversation, conversation[0])).toBe('');
  });
});
