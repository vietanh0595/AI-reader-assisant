import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export type SignInSheetProps = {
  error: string | null;
  isLoading: boolean;
  onClose: () => void;
  onSignIn: () => void;
};

export function SignInSheet({ error, isLoading, onClose, onSignIn }: SignInSheetProps) {
  return (
    <View style={styles.overlay}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Sign In</Text>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.closeButton}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        <Text style={styles.body}>
          An account is required to import personal books and use the camera to scan pages.
          The sample book is always available without signing in.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          accessibilityLabel="Continue to sign in"
          accessibilityRole="button"
          disabled={isLoading}
          onPress={isLoading ? undefined : onSignIn}
          style={[styles.signInButton, isLoading && styles.signInButtonDisabled]}
        >
          {isLoading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.signInText}>Continue to sign in</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 40,
    paddingHorizontal: 24,
    paddingTop: 20,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    color: '#666',
    fontSize: 16,
  },
  body: {
    color: '#444',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  error: {
    color: '#c0392b',
    fontSize: 14,
    marginBottom: 12,
  },
  signInButton: {
    alignItems: 'center',
    backgroundColor: '#2d6a4f',
    borderRadius: 10,
    paddingVertical: 14,
  },
  signInButtonDisabled: {
    opacity: 0.6,
  },
  signInText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
