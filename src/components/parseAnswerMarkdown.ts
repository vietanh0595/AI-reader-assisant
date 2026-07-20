export type AnswerSpan = { text: string; bold?: boolean; code?: boolean };

export type AnswerBlock =
  | { type: 'paragraph'; spans: AnswerSpan[] }
  | { type: 'bullet_list'; items: AnswerSpan[][] }
  | { type: 'numbered_list'; items: AnswerSpan[][] };

const BULLET_LINE = /^\s*[-*]\s+(.*)$/;
const NUMBERED_LINE = /^\s*\d+\.\s+(.*)$/;

export function parseAnswerMarkdown(text: string): AnswerBlock[] {
  const lines = text.split('\n');
  const blocks: AnswerBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE);
    if (bulletMatch) {
      const items: AnswerSpan[][] = [];
      while (i < lines.length) {
        const match = lines[i].match(BULLET_LINE);
        if (!match) {
          break;
        }
        items.push(parseInlineSpans(match[1]));
        i++;
      }
      blocks.push({ type: 'bullet_list', items });
      continue;
    }

    const numberedMatch = line.match(NUMBERED_LINE);
    if (numberedMatch) {
      const items: AnswerSpan[][] = [];
      while (i < lines.length) {
        const match = lines[i].match(NUMBERED_LINE);
        if (!match) {
          break;
        }
        items.push(parseInlineSpans(match[1]));
        i++;
      }
      blocks.push({ type: 'numbered_list', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(BULLET_LINE) &&
      !lines[i].match(NUMBERED_LINE)
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', spans: parseInlineSpans(paragraphLines.join(' ')) });
  }

  return blocks;
}

const INLINE_MARKER = /\*\*(.+?)\*\*|`(.+?)`/g;

function parseInlineSpans(text: string): AnswerSpan[] {
  const spans: AnswerSpan[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_MARKER.lastIndex = 0;
  while ((match = INLINE_MARKER.exec(text)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      spans.push({ text: match[1], bold: true });
    } else if (match[2] !== undefined) {
      spans.push({ text: match[2], code: true });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex) });
  }

  if (spans.length === 0) {
    spans.push({ text: '' });
  }

  return spans;
}
