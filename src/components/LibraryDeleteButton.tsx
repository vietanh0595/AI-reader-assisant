import { Trash2 } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

// From App.tsx's `colors`. Keep in step with the palette there if it changes.
const MUTED_INK = '#6d6860';

type LibraryDeleteButtonProps = {
  bookTitle: string;
  // Removing a book with Whole-Book AI switched on waits on a network round-trip to
  // delete the server copy. Without visible progress the row looks frozen and the
  // reader taps again — which is why the button also stops responding while it runs.
  isDeleting: boolean;
  onPress: () => void;
};

export function LibraryDeleteButton({ bookTitle, isDeleting, onPress }: LibraryDeleteButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isDeleting ? `Deleting ${bookTitle}` : `Remove ${bookTitle}`}
      accessibilityState={{ disabled: isDeleting }}
      disabled={isDeleting}
      onPress={onPress}
      style={styles.button}
    >
      {isDeleting ? (
        <ActivityIndicator color={MUTED_INK} size="small" />
      ) : (
        <Trash2 color={MUTED_INK} size={18} strokeWidth={2} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
});
