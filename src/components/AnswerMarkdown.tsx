import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { parseAnswerMarkdown, type AnswerBlock, type AnswerSpan } from './answerMarkdown';

export type AnswerMarkdownProps = {
  text: string;
};

export function AnswerMarkdown({ text }: AnswerMarkdownProps) {
  const blocks = parseAnswerMarkdown(text);

  return (
    <View>
      {blocks.map((block, blockIndex) => (
        <View key={blockIndex} style={blockIndex > 0 ? styles.blockSpacing : undefined}>
          <AnswerBlockView block={block} />
        </View>
      ))}
    </View>
  );
}

function AnswerBlockView({ block }: { block: AnswerBlock }) {
  if (block.type === 'paragraph') {
    return (
      <Text style={styles.text}>
        <AnswerSpans spans={block.spans} />
      </Text>
    );
  }

  return (
    <View>
      {block.items.map((spans, index) => (
        <View key={index} style={styles.listItem} testID="answer-list-item">
          <Text style={styles.listMarker}>{block.type === 'numbered_list' ? `${index + 1}.` : '•'}</Text>
          <Text style={styles.listItemText}>
            <AnswerSpans spans={spans} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function AnswerSpans({ spans }: { spans: AnswerSpan[] }) {
  return (
    <>
      {spans.map((span, index) => (
        <Text key={index} style={[span.bold && styles.bold, span.code && styles.code]}>
          {span.text}
        </Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  blockSpacing: {
    marginTop: 8,
  },
  text: {
    fontSize: 14,
    lineHeight: 21,
    color: '#171715',
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  listMarker: {
    fontSize: 14,
    lineHeight: 21,
    color: '#171715',
    width: 20,
  },
  listItemText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#171715',
    flex: 1,
  },
  bold: {
    fontWeight: '700',
  },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
});
