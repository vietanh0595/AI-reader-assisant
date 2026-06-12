import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WholeBookAiState } from '../rag/types';

export type WholeBookAiSheetProps = {
  state: WholeBookAiState;
  onClose: () => void;
  onEnable: () => void;
  onRetry: () => void;
};

export function WholeBookAiSheet({ state, onClose, onEnable, onRetry }: WholeBookAiSheetProps) {
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Whole-Book AI</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.closeButton}>✕</Text>
            </Pressable>
          </View>

          {state.status === 'not_enabled' && (
            <View>
              <Text style={styles.body}>
                Normalized book text will be uploaded to our servers to build a searchable index.
                Original files never leave your device.
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

          {(state.status === 'uploading' || state.status === 'queued') && (
            <View>
              <Text style={styles.statusLabel}>Uploading…</Text>
              <ProgressTrack progress={state.progress} />
            </View>
          )}

          {state.status === 'indexing' && (
            <View>
              <Text style={styles.statusLabel}>Indexing…</Text>
              <ProgressTrack progress={state.progress} />
            </View>
          )}

          {state.status === 'ready' && (
            <View>
              <Text style={styles.successText}>Whole-Book AI is ready.</Text>
              <Text style={styles.body}>
                Book scope is now available in the reader for full-book questions.
              </Text>
            </View>
          )}

          {state.status === 'failed' && (
            <View>
              <Text style={styles.errorText}>{state.error ?? 'Indexing failed.'}</Text>
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
        </View>
      </View>
    </Modal>
  );
}

function ProgressTrack({ progress }: { progress: number }) {
  const pct = Math.min(Math.max(progress, 0), 1);
  return (
    <View style={styles.trackContainer}>
      <View style={[styles.trackFill, { width: `${Math.round(pct * 100)}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    fontSize: 20,
    color: '#666',
    padding: 4,
  },
  body: {
    fontSize: 14,
    color: '#444',
    lineHeight: 20,
    marginBottom: 20,
  },
  statusLabel: {
    fontSize: 14,
    color: '#555',
    marginBottom: 12,
  },
  successText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#16a34a',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#dc2626',
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  trackContainer: {
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  trackFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 3,
  },
});
