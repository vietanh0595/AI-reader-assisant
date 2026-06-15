import React from 'react';
import { DimensionValue, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WholeBookAiState } from '../rag/types';

export type WholeBookAiSheetProps = {
  state: WholeBookAiState;
  onClose: () => void;
  onEnable: () => void;
  onRetry: () => void;
};

const palette = {
  paper: '#fffdf8',
  ink: '#171715',
  mutedInk: '#6d6860',
  sageDark: '#244f38',
  hairline: '#e4dfd6',
  track: '#e7e3da',
  error: '#9c2f2f',
  scrim: 'rgba(23,23,21,0.45)',
};

function pct(progress: number): number {
  return Math.round(Math.min(Math.max(progress, 0), 1) * 100);
}

export function WholeBookAiSheet({ state, onClose, onEnable, onRetry }: WholeBookAiSheetProps) {
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Dismiss" accessibilityRole="button">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>✦ Book AI</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <Text style={styles.closeButton}>✕</Text>
            </Pressable>
          </View>

          {state.status === 'not_enabled' && (
            <View>
              <Text style={styles.body}>
                Normalized book text will be uploaded to our servers to build a searchable index, so
                you can ask questions across the whole book. Original files never leave your device.
              </Text>
              <Pressable
                style={styles.primaryButton}
                onPress={onEnable}
                accessibilityRole="button"
                accessibilityLabel="Enable whole-book AI"
              >
                <Text style={styles.primaryButtonText}>Enable whole-book AI</Text>
              </Pressable>
            </View>
          )}

          {state.status === 'uploading' && (
            <View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Uploading…</Text>
                <Text style={styles.statusPercent}>{pct(state.progress)}%</Text>
              </View>
              <ProgressTrack progress={state.progress} />
              <Text style={styles.hint}>You can close this — indexing continues in the background.</Text>
            </View>
          )}

          {state.status === 'queued' && (
            <View>
              <Text style={styles.statusLabel}>Queued — waiting to index…</Text>
              <ProgressTrack progress={state.progress} indeterminate />
              <Text style={styles.hint}>You can close this — indexing continues in the background.</Text>
            </View>
          )}

          {state.status === 'indexing' && (
            <View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Indexing…</Text>
                <Text style={styles.statusPercent}>{pct(state.progress)}%</Text>
              </View>
              <ProgressTrack progress={state.progress} />
              <Text style={styles.hint}>You can close this — indexing continues in the background.</Text>
            </View>
          )}

          {state.status === 'ready' && (
            <View>
              <Text style={styles.successText}>Whole-Book AI is ready.</Text>
              <Text style={styles.body}>
                Pick the “Book” scope in the reader to ask questions across the whole book.
              </Text>
              <Pressable
                style={styles.primaryButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Start asking"
              >
                <Text style={styles.primaryButtonText}>Start asking</Text>
              </Pressable>
            </View>
          )}

          {state.status === 'failed' && (
            <View>
              <Text style={styles.errorText}>{state.error ?? 'Indexing failed. Please try again.'}</Text>
              <Pressable
                style={styles.primaryButton}
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel="Retry"
              >
                <Text style={styles.primaryButtonText}>Retry</Text>
              </Pressable>
            </View>
          )}

          {state.status === 'deleting' && (
            <View>
              <Text style={styles.statusLabel}>Removing from cloud…</Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ProgressTrack({ progress, indeterminate }: { progress: number; indeterminate?: boolean }) {
  const width: DimensionValue = indeterminate ? '40%' : `${pct(progress)}%`;
  return (
    <View style={styles.trackContainer}>
      <View style={[styles.trackFill, { width }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: palette.scrim,
  },
  sheet: {
    backgroundColor: palette.paper,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: palette.hairline,
    borderRadius: 3,
    height: 5,
    marginBottom: 16,
    width: 44,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.ink,
  },
  closeButton: {
    fontSize: 18,
    color: palette.mutedInk,
    padding: 4,
  },
  body: {
    fontSize: 14,
    color: palette.mutedInk,
    lineHeight: 20,
    marginBottom: 20,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.ink,
    marginBottom: 10,
  },
  statusPercent: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.sageDark,
    marginBottom: 0,
  },
  hint: {
    fontSize: 12,
    color: palette.mutedInk,
    marginTop: 12,
  },
  successText: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.sageDark,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: palette.error,
    marginBottom: 16,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: palette.sageDark,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: palette.paper,
    fontWeight: '700',
    fontSize: 15,
  },
  trackContainer: {
    height: 6,
    backgroundColor: palette.track,
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: palette.sageDark,
    borderRadius: 3,
  },
});
