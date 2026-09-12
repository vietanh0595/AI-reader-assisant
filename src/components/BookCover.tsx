import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { pickCoverCardColor } from '../library/coverCard';

export type BookCoverProps = {
  author: string;
  // Absent for books imported before covers existed, and for files that declare
  // none — both fall back to a generated card rather than an empty slot.
  coverUri?: string;
  title: string;
};

export function BookCover({ author, coverUri, title }: BookCoverProps) {
  if (coverUri) {
    return (
      <Image
        accessibilityLabel={`Cover of ${title}`}
        accessible
        resizeMode="cover"
        source={{ uri: coverUri }}
        style={styles.cover}
      />
    );
  }

  return (
    // No accessibilityLabel here: the title and author are already readable as text,
    // and labelling the container would collapse them into one duplicated
    // announcement.
    <View style={[styles.cover, styles.card, { backgroundColor: pickCoverCardColor(title) }]}>
      <Text numberOfLines={3} style={styles.cardTitle}>
        {title}
      </Text>
      <Text numberOfLines={1} style={styles.cardAuthor}>
        {author}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    backgroundColor: '#e4dfd6',
    borderRadius: 6,
    height: 66,
    width: 46,
  },
  card: {
    justifyContent: 'space-between',
    padding: 5,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: '700',
    lineHeight: 10,
  },
  cardAuthor: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 7,
    lineHeight: 9,
  },
});
