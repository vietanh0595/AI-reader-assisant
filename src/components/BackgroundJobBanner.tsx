import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SelectedPendingNotice } from '../rag/backgroundNotice';

export type BackgroundJobBannerProps = {
  notice: SelectedPendingNotice | null;
  onDismiss: () => void;
  onView: () => void;
};

function bannerCopy(notice: SelectedPendingNotice): string {
  if (notice.status === 'ready') {
    return `'${notice.bookTitle}' is ready`;
  }
  const jobLabel = notice.kind === 'indexing' ? 'Indexing' : 'Mind map';
  return `${jobLabel} for '${notice.bookTitle}' failed`;
}

export function BackgroundJobBanner({ notice, onDismiss, onView }: BackgroundJobBannerProps) {
  const insets = useSafeAreaInsets();

  if (!notice) {
    return null;
  }

  return (
    <View style={[styles.banner, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.text}>{bannerCopy(notice)}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onView} style={styles.viewButton}>
          <Text style={styles.viewText}>View</Text>
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
  viewButton: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  viewText: {
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
