// A saved note reduced to display-ready strings. Taking labels as inputs keeps this
// module free of App.tsx's local DocumentSourceRef/InsightAction types and its
// formatSourceRef helper, so export formatting is testable in isolation.
export type ExportableNote = {
  actionLabel: string;
  body: string;
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

  return lines.join('\n\n');
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
