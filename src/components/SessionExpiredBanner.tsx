import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SessionExpiredBannerProps = {
  sessionExpired: boolean;
  onDismiss: () => void;
  onSignIn: () => void;
};

export function SessionExpiredBanner({
  sessionExpired,
  onDismiss,
  onSignIn,
}: SessionExpiredBannerProps) {
  const insets = useSafeAreaInsets();

  if (!sessionExpired) {
    return null;
  }

  return (
    <View style={[styles.banner, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.text}>
        Your sign-in has expired. Sign in again to ask questions and sync your library.
      </Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.signInButton}>
          <Text style={styles.signInText}>Sign in</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.dismissButton}
        >
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    backgroundColor: '#2d6a4f',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  text: {
    color: '#ffffff',
    flex: 1,
    fontSize: 13,
    marginRight: 12,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  signInButton: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  signInText: {
    color: '#2d6a4f',
    fontSize: 13,
    fontWeight: '600',
  },
  dismissButton: {
    padding: 4,
  },
  dismissText: {
    color: '#ffffff',
    fontSize: 16,
  },
});
