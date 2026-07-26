import {
  buildAnkiFile,
  buildCardsFromResults,
  classifyNoteForAnkiExport,
  formatAnkiCardLine,
  toAnkiNoteInput,
  type AnkiSourceNote,
} from './ankiExport';

const note = (over: Partial<AnkiSourceNote> = {}): AnkiSourceNote => ({
  id: 'n1',
  action: 'ask',
  question: '',
  body: '',
  selectedText: '',
  ...over,
});

describe('classifyNoteForAnkiExport', () => {
  test('an ask note is pure formatting', () => {
    expect(classifyNoteForAnkiExport(note({ action: 'ask' }))).toBe('formatted');
  });

  test.each(['highlight', 'explain', 'example', 'rephrase', 'simpler', 'summarize'] as const)(
    '%s notes need AI',
    (action) => {
      expect(classifyNoteForAnkiExport(note({ action }))).toBe('needsAi');
    },
  );
});

describe('toAnkiNoteInput', () => {
  test('maps a passage and answer', () => {
    const input = toAnkiNoteInput(
      note({ id: 'n2', action: 'explain', selectedText: 'A passage.', body: 'An explanation.' }),
    );
    expect(input).toEqual({
      noteId: 'n2',
      action: 'explain',
      passage: 'A passage.',
      answer: 'An explanation.',
      userNote: undefined,
    });
  });

  test('omits empty passage and answer rather than sending empty strings', () => {
    const input = toAnkiNoteInput(note({ id: 'n3', action: 'highlight', selectedText: '', body: '' }));
    expect(input.passage).toBeUndefined();
    expect(input.answer).toBeUndefined();
  });

  test('carries the reader\'s own note through', () => {
    const input = toAnkiNoteInput(note({ id: 'n4', action: 'highlight', userNote: 'revisit this' }));
    expect(input.userNote).toBe('revisit this');
  });

  test('truncates a passage longer than the backend\'s 4000-char cap', () => {
    const longPassage = 'a'.repeat(4500);
    const input = toAnkiNoteInput(note({ id: 'n5', action: 'highlight', selectedText: longPassage }));
    expect(input.passage).toHaveLength(4000);
    expect(input.passage).toBe('a'.repeat(4000));
  });

  test('truncates an answer longer than the backend\'s 4000-char cap', () => {
    const longAnswer = 'b'.repeat(4500);
    const input = toAnkiNoteInput(note({ id: 'n6', action: 'explain', body: longAnswer }));
    expect(input.answer).toHaveLength(4000);
    expect(input.answer).toBe('b'.repeat(4000));
  });

  test('truncates a user note longer than the backend\'s 2000-char cap', () => {
    const longUserNote = 'c'.repeat(2500);
    const input = toAnkiNoteInput(note({ id: 'n7', action: 'highlight', userNote: longUserNote }));
    expect(input.userNote).toHaveLength(2000);
    expect(input.userNote).toBe('c'.repeat(2000));
  });

  test('does not truncate a passage at or under the cap', () => {
    const exactPassage = 'd'.repeat(4000);
    const input = toAnkiNoteInput(note({ id: 'n8', action: 'highlight', selectedText: exactPassage }));
    expect(input.passage).toHaveLength(4000);
  });
});

describe('formatAnkiCardLine', () => {
  test('joins front and back with a tab', () => {
    expect(formatAnkiCardLine('Q', 'A')).toBe('Q\tA');
  });

  test('strips a literal tab out of a field', () => {
    expect(formatAnkiCardLine('Q\twith tab', 'A')).toBe('Q with tab\tA');
  });

  test('collapses an embedded newline to a space', () => {
    expect(formatAnkiCardLine('Q', 'Line one\nline two')).toBe('Q\tLine one line two');
  });

  test('collapses a Windows-style newline to a space', () => {
    expect(formatAnkiCardLine('Q', 'Line one\r\nline two')).toBe('Q\tLine one line two');
  });
});

describe('buildAnkiFile', () => {
  test('joins cards with newlines', () => {
    expect(buildAnkiFile([{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }])).toBe('Q1\tA1\nQ2\tA2');
  });

  test('returns an empty string for no cards', () => {
    expect(buildAnkiFile([])).toBe('');
  });
});

describe('buildCardsFromResults', () => {
  test('formats an ask note directly, ignoring aiResults', () => {
    const notes = [note({ id: 'n1', action: 'ask', question: 'What is X?', body: 'X is Y.' })];
    expect(buildCardsFromResults(notes, [])).toEqual([{ front: 'What is X?', back: 'X is Y.' }]);
  });

  test('flattens Markdown out of an ask note\'s answer', () => {
    const notes = [note({ id: 'n1', action: 'ask', question: 'Q', body: '- **one**\n- two' })];
    expect(buildCardsFromResults(notes, [])).toEqual([{ front: 'Q', back: 'one; two' }]);
  });

  test('skips an ask note with no question', () => {
    const notes = [note({ id: 'n1', action: 'ask', question: '', body: 'An answer.' })];
    expect(buildCardsFromResults(notes, [])).toEqual([]);
  });

  test('pulls a needsAi note\'s card from aiResults by noteId', () => {
    const notes = [note({ id: 'n2', action: 'highlight' })];
    const cards = buildCardsFromResults(notes, [{ noteId: 'n2', front: 'Generated Q', back: 'Generated A' }]);
    expect(cards).toEqual([{ front: 'Generated Q', back: 'Generated A' }]);
  });

  test('omits a needsAi note the AI result set has no entry for', () => {
    const notes = [note({ id: 'n2', action: 'highlight' })];
    expect(buildCardsFromResults(notes, [])).toEqual([]);
  });

  test('preserves original note order across mixed formatted and needsAi notes', () => {
    const notes = [
      note({ id: 'n1', action: 'highlight' }),
      note({ id: 'n2', action: 'ask', question: 'Q2', body: 'A2' }),
      note({ id: 'n3', action: 'explain' }),
    ];
    const cards = buildCardsFromResults(notes, [
      { noteId: 'n3', front: 'Q3', back: 'A3' },
      { noteId: 'n1', front: 'Q1', back: 'A1' },
    ]);
    expect(cards).toEqual([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
      { front: 'Q3', back: 'A3' },
    ]);
  });
});
