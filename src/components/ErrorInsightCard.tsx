import { HelpCircle } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// Lifted from App.tsx's `colors` so this card can live in src/components and be
// tested. Keep in step with the palette there if it ever changes.
const ERROR = '#9c2f2f';
const ERROR_BACKGROUND = '#fff1f1';
const ERROR_BORDER = '#e7b6b6';
const SHADOW = '#191815';

type ErrorInsightCardProps = {
  message: string;
  // Optional on purpose: some failures aren't a re-runnable request (an empty page
  // has nothing to summarize), and a Retry there would only fail the same way.
  onRetry?: () => void;
};

export function ErrorInsightCard({ message, onRetry }: ErrorInsightCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <HelpCircle color={ERROR} size={17} strokeWidth={2} />
        <Text style={styles.eyebrow}>AI unavailable</Text>
      </View>
      <Text style={styles.body}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          onPress={onRetry}
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>↺ Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: ERROR_BACKGROUND,
    borderColor: ERROR_BORDER,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
    shadowColor: SHADOW,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 9,
  },
  eyebrow: {
    color: ERROR,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  body: {
    color: ERROR,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 18,
  },
  // Matches the chat sheet's Retry so the two error states read as the same app.
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: ERROR,
    borderRadius: 10,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
