// A saved note reduced to display-ready strings. Taking labels as inputs keeps this
// module free of App.tsx's local DocumentSourceRef/InsightAction types and its
// formatSourceRef helper, so export formatting is testable in isolation.
export type ExportableCitation = {
  chapterTitle?: string;
  excerpt: string;
  pageIndex?: number;
  pageLabel?: string;
};

export type ExportableNote = {
  actionLabel: string;
  body: string;
  citations?: ExportableCitation[];
  createdAt: string;
  question: string;
  selectedText: string;
  sourceLabel?: string;
  userNote?: string;
};

export function formatNoteAsText(note: ExportableNote, index: number): string {
  const lines = [`${index + 1}. ${note.actionLabel} - ${formatNoteDate(note.createdAt)}`];

  if (note.sourceLabel) {
    lines.push(`Source: ${note.sourceLabel}`);
  }

  // question/selectedText/body gate on their trimmed value, not raw truthiness, so a
  // whitespace-only field is treated as absent instead of emitting an empty labeled line
  // (e.g. "Selected: " with nothing after it). This is intentional, not an oversight.
  if (note.question.trim()) {
    lines.push(`Q: ${note.question}`);
  }

  if (note.selectedText.trim()) {
    lines.push(`Selected: ${note.selectedText}`);
  }

  if (note.body.trim()) {
    lines.push(`AI: ${note.body}`);
  }

  if (note.userNote) {
    lines.push(`Note: ${note.userNote}`);
  }

  for (const citation of note.citations ?? []) {
    lines.push(`Cited: ${formatCitationLabel(citation)}`);
  }

  return lines.join('\n');
}

export function formatNoteAsMarkdown(note: ExportableNote, index: number): string {
  const lines = [`### ${index + 1}. ${note.actionLabel} — ${formatNoteDate(note.createdAt)}`];

  if (note.sourceLabel) {
    lines.push(`*${note.sourceLabel}*`);
  }

  // See the matching comment in formatNoteAsText: gate on the trimmed value so a
  // whitespace-only field is treated as absent.
  if (note.question.trim()) {
    lines.push(`**Q:** ${note.question}`);
  }

  if (note.selectedText.trim()) {
    lines.push(`> ${note.selectedText.replace(/\n/g, '\n> ')}`);
  }

  if (note.body.trim()) {
    lines.push(`**AI:** ${note.body}`);
  }

  if (note.userNote) {
    lines.push(`**Note:** ${note.userNote}`);
  }

  const citations = note.citations ?? [];

  if (citations.length > 0) {
    lines.push(
      ['**Cited:**', ...citations.map((citation) => `- ${formatCitationLabel(citation)}`)].join('\n'),
    );
  }

  return lines.join('\n\n');
}

export function formatCitationLabel(citation: ExportableCitation): string {
  // Nullish-safe on purpose: the ask API serializes an absent pageIndex as JSON `null`
  // (every EPUB answer), and a `null` that slipped past normalization at the API boundary
  // would otherwise render as "Page 1" — `null + 1` is 1. A missing page falls through to
  // the chapter title, or to the excerpt, exactly like a citation with no page info.
  const page = citation.pageLabel ?? (citation.pageIndex != null ? `Page ${citation.pageIndex + 1}` : '');
  const parts = [citation.chapterTitle, page].filter((part) => part);

  return parts.length > 0 ? parts.join(' · ') : citation.excerpt.slice(0, 80);
}

export function formatNoteDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
