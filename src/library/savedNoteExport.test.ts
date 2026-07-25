import {
  formatCitationLabel,
  formatNoteAsMarkdown,
  formatNoteAsText,
  formatNoteDate,
  type ExportableNote,
} from './savedNoteExport';

const note = (over: Partial<ExportableNote> = {}): ExportableNote => ({
  actionLabel: 'Ask',
  body: 'Consumer purchases drive economic activity.',
  createdAt: '2026-07-25T10:00:00.000Z',
  question: '',
  selectedText: '',
  ...over,
});

describe('formatNoteDate', () => {
  test('returns the raw value when it is not a date', () => {
    expect(formatNoteDate('not-a-date')).toBe('not-a-date');
  });

  test('formats a valid ISO date', () => {
    expect(formatNoteDate('2026-07-25T10:00:00.000Z')).toMatch(/2026/);
  });
});

describe('formatNoteAsText', () => {
  test('numbers the note and labels its action', () => {
    expect(formatNoteAsText(note(), 0)).toContain('1. Ask - ');
  });

  test('includes the source label when present', () => {
    expect(formatNoteAsText(note({ sourceLabel: 'PDF 175' }), 0)).toContain('Source: PDF 175');
  });

  test('includes the question when present', () => {
    expect(formatNoteAsText(note({ question: '529 Plan — example' }), 0)).toContain('Q: 529 Plan — example');
  });

  test('omits the question line when empty', () => {
    expect(formatNoteAsText(note(), 0)).not.toContain('Q:');
  });

  test('omits the selected line when there is no selection', () => {
    expect(formatNoteAsText(note(), 0)).not.toContain('Selected:');
  });

  test('omits the AI line for a note with no body', () => {
    expect(formatNoteAsText(note({ body: '' }), 0)).not.toContain('AI:');
  });

  test('includes the user note when present', () => {
    expect(formatNoteAsText(note({ userNote: 'revisit this' }), 0)).toContain('Note: revisit this');
  });

  test('omits the selected line for a whitespace-only selection', () => {
    expect(formatNoteAsText(note({ selectedText: '   ' }), 0)).not.toContain('Selected:');
  });
});

describe('formatNoteAsMarkdown', () => {
  test('uses a level-three heading with the action label', () => {
    expect(formatNoteAsMarkdown(note(), 0)).toMatch(/^### 1\. Ask — /);
  });

  test('italicises the source label', () => {
    expect(formatNoteAsMarkdown(note({ sourceLabel: 'PDF 175' }), 0)).toContain('*PDF 175*');
  });

  test('bolds the question label', () => {
    expect(formatNoteAsMarkdown(note({ question: '529 Plan — example' }), 0)).toContain(
      '**Q:** 529 Plan — example',
    );
  });

  test('blockquotes the selection', () => {
    expect(formatNoteAsMarkdown(note({ selectedText: 'The most basic premise' }), 0)).toContain(
      '> The most basic premise',
    );
  });

  test('emits no blockquote when there is no selection', () => {
    expect(formatNoteAsMarkdown(note(), 0)).not.toContain('>');
  });

  test('emits no AI section for a highlight with no body', () => {
    expect(formatNoteAsMarkdown(note({ actionLabel: 'Highlight', body: '' }), 0)).not.toContain('**AI:**');
  });

  test('emits no blockquote for a whitespace-only selection', () => {
    const markdown = formatNoteAsMarkdown(note({ selectedText: '   ' }), 0);
    expect(markdown).not.toContain('>');
  });
});

describe('formatCitationLabel', () => {
  test('joins chapter and page label', () => {
    expect(formatCitationLabel({ chapterTitle: 'Chapter 7', excerpt: 'x', pageLabel: '175' })).toBe(
      'Chapter 7 · 175',
    );
  });

  test('derives a page number from pageIndex when there is no label', () => {
    expect(formatCitationLabel({ chapterTitle: 'Chapter 7', excerpt: 'x', pageIndex: 174 })).toBe(
      'Chapter 7 · Page 175',
    );
  });

  test('falls back to a trimmed excerpt when there is no chapter or page', () => {
    expect(formatCitationLabel({ excerpt: 'Only for College' })).toBe('Only for College');
  });

  // The ask API serializes an absent pageIndex/pageLabel as JSON `null` (every EPUB
  // answer). saveChatTurn normalizes that to `undefined` before persisting, but a label
  // must degrade gracefully rather than claim "Page 1" (`null + 1`) if one slips through.
  test('treats a null pageIndex as no page at all, not Page 1', () => {
    const citation = { excerpt: 'Only for College', pageIndex: null, pageLabel: null } as any;
    expect(formatCitationLabel(citation)).toBe('Only for College');
  });

  test('keeps the chapter title when the pageIndex is null', () => {
    const citation = { chapterTitle: 'Chapter 7', excerpt: 'x', pageIndex: null, pageLabel: null } as any;
    expect(formatCitationLabel(citation)).toBe('Chapter 7');
  });
});

describe('citations in exports', () => {
  const cited = note({
    citations: [
      { chapterTitle: 'Chapter 7', excerpt: 'Only for College', pageLabel: '175' },
      { chapterTitle: 'Chapter 7', excerpt: 'All about 529 Plans', pageLabel: '174' },
    ],
  });

  test('text export lists each citation', () => {
    const output = formatNoteAsText(cited, 0);
    expect(output).toContain('Cited: Chapter 7 · 175');
    expect(output).toContain('Cited: Chapter 7 · 174');
  });

  test('markdown export lists citations under a bold label', () => {
    const output = formatNoteAsMarkdown(cited, 0);
    expect(output).toContain('**Cited:**');
    expect(output).toContain('- Chapter 7 · 175');
  });

  test('neither export emits a citation section when there are none', () => {
    expect(formatNoteAsText(note(), 0)).not.toContain('Cited');
    expect(formatNoteAsMarkdown(note(), 0)).not.toContain('Cited');
  });
});
