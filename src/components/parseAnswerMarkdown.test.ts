import { parseAnswerMarkdown } from './parseAnswerMarkdown';

test('parses a single plain paragraph', () => {
  expect(parseAnswerMarkdown('Start early.')).toEqual([
    { type: 'paragraph', spans: [{ text: 'Start early.' }] },
  ]);
});

test('parses multiple paragraphs separated by a blank line', () => {
  const result = parseAnswerMarkdown('First paragraph.\n\nSecond paragraph.');
  expect(result).toEqual([
    { type: 'paragraph', spans: [{ text: 'First paragraph.' }] },
    { type: 'paragraph', spans: [{ text: 'Second paragraph.' }] },
  ]);
});

test('parses bold spans within a paragraph', () => {
  const result = parseAnswerMarkdown('**Compound interest** grows over time.');
  expect(result).toEqual([
    {
      type: 'paragraph',
      spans: [
        { text: 'Compound interest', bold: true },
        { text: ' grows over time.' },
      ],
    },
  ]);
});

test('parses inline code spans within a paragraph', () => {
  const result = parseAnswerMarkdown('Call `runBookAsk` to ask a question.');
  expect(result).toEqual([
    {
      type: 'paragraph',
      spans: [
        { text: 'Call ' },
        { text: 'runBookAsk', code: true },
        { text: ' to ask a question.' },
      ],
    },
  ]);
});

test('parses a bullet list', () => {
  const result = parseAnswerMarkdown('- Interest on principal\n- Interest on prior interest');
  expect(result).toEqual([
    {
      type: 'bullet_list',
      items: [
        [{ text: 'Interest on principal' }],
        [{ text: 'Interest on prior interest' }],
      ],
    },
  ]);
});

test('parses a numbered list', () => {
  const result = parseAnswerMarkdown('1. Faster growth later\n2. A bigger gap the longer you wait');
  expect(result).toEqual([
    {
      type: 'numbered_list',
      items: [
        [{ text: 'Faster growth later' }],
        [{ text: 'A bigger gap the longer you wait' }],
      ],
    },
  ]);
});

test('parses a mixed paragraph, list, and paragraph answer', () => {
  const text =
    'Compound interest grows in two ways:\n\n' +
    '- Interest on principal\n' +
    '- Interest on prior interest\n\n' +
    'Over time this creates a bigger gap.';
  const result = parseAnswerMarkdown(text);
  expect(result).toEqual([
    { type: 'paragraph', spans: [{ text: 'Compound interest grows in two ways:' }] },
    {
      type: 'bullet_list',
      items: [
        [{ text: 'Interest on principal' }],
        [{ text: 'Interest on prior interest' }],
      ],
    },
    { type: 'paragraph', spans: [{ text: 'Over time this creates a bigger gap.' }] },
  ]);
});

test('degrades an unclosed bold marker to literal text', () => {
  const result = parseAnswerMarkdown('This is **bold text without a closing marker.');
  expect(result).toEqual([
    {
      type: 'paragraph',
      spans: [{ text: 'This is **bold text without a closing marker.' }],
    },
  ]);
});

test('treats a stray asterisk or dash mid-sentence as literal text, not a list', () => {
  const result = parseAnswerMarkdown('The result is 5 * 3 - 2, which is interesting.');
  expect(result).toEqual([
    {
      type: 'paragraph',
      spans: [{ text: 'The result is 5 * 3 - 2, which is interesting.' }],
    },
  ]);
});

test('returns an empty array for an empty string', () => {
  expect(parseAnswerMarkdown('')).toEqual([]);
});
