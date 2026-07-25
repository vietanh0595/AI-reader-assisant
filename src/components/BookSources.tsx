import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BookSource } from '../rag/bookAskTypes';

type BookSourcesProps = {
  sources: BookSource[];
  onNavigate: (paragraphId: string, excerpt?: string) => void;
};

export function BookSources({ sources, onNavigate }: BookSourcesProps) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <View testID="book-sources-container">
      <Text style={styles.heading}>Sources</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.row}>
        {sources.map((source) => {
          // The ask API sends an absent pageIndex/pageLabel as JSON `null`, not as an
          // omitted key — that is every EPUB answer. Gate nullish-safely: `!== undefined`
          // would label an EPUB source "Page 1", because `null + 1` is 1.
          const pageText =
            source.pageLabel ?? (source.pageIndex != null ? `Page ${source.pageIndex + 1}` : undefined);

          return (
            <Pressable
              key={source.id}
              accessibilityRole="button"
              accessibilityLabel={source.chapterTitle ? `Source: ${source.chapterTitle}` : 'Source'}
              onPress={() => onNavigate(source.paragraphId, source.excerpt)}
              style={styles.chip}
            >
              {source.chapterTitle ? (
                <Text style={styles.chapterTitle} numberOfLines={1}>
                  {source.chapterTitle}
                </Text>
              ) : null}
              {pageText ? (
                <Text style={styles.pageLabel} numberOfLines={1}>
                  {pageText}
                </Text>
              ) : null}
              <Text style={styles.excerpt} numberOfLines={2}>
                {source.excerpt}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    color: '#78746d',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  row: {
    gap: 10,
    paddingRight: 4,
  },
  chip: {
    backgroundColor: '#f3f1ec',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e4dfd6',
    maxWidth: 200,
    padding: 10,
  },
  chapterTitle: {
    color: '#244f38',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  pageLabel: {
    color: '#6b7280',
    fontSize: 10,
    marginBottom: 4,
  },
  excerpt: {
    color: '#3f3b34',
    fontSize: 12,
    lineHeight: 16,
  },
});
