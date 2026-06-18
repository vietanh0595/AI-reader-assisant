import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ConversationTurn } from '../library/conversation';
import { BookSources } from './BookSources';

type ConversationThreadProps = {
  turns: ConversationTurn[];
  includeWholeBook: boolean;
  selectedText?: string;
  isLoading: boolean;
  onSubmit: (text: string) => void;
  onToggleWholeBook: () => void;
  onClear: () => void;
  onNavigateSource: (paragraphId: string) => void;
  onClearSelection: () => void;
  onClose: () => void;
};

export function ConversationThread({
  turns,
  includeWholeBook,
  selectedText,
  isLoading,
  onSubmit,
  onToggleWholeBook,
  onClear,
  onNavigateSource,
  onClearSelection,
  onClose,
}: ConversationThreadProps) {
  const [draft, setDraft] = useState('');

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    setDraft('');
    onSubmit(text);
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.handle} />
      <View style={styles.head}>
        <Text style={styles.title}>Ask the book</Text>
        <View style={styles.headRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle whole book context"
            onPress={onToggleWholeBook}
            style={styles.toggle}
          >
            <Text style={styles.toggleLabel}>
              {includeWholeBook ? 'Whole book' : 'Book so far'}
            </Text>
            <View
              style={[styles.switch, includeWholeBook ? styles.switchOn : styles.switchOff]}
            >
              <View
                style={[styles.knob, includeWholeBook ? styles.knobOn : styles.knobOff]}
              />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear conversation"
            onPress={onClear}
            style={styles.iconButton}
          >
            <Text style={styles.trash}>Clear</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.iconButton}
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.convo} contentContainerStyle={styles.convoContent}>
        {turns.map((turn) =>
          turn.role === 'user' ? (
            <View key={turn.id} style={styles.userRow}>
              <View style={styles.userBubble}>
                <Text style={styles.userText}>{turn.text}</Text>
              </View>
            </View>
          ) : (
            <View key={turn.id} style={styles.turn}>
              <View style={styles.answer}>
                <Text style={styles.answerText}>{turn.text}</Text>
                {turn.sources && turn.sources.length > 0 ? (
                  <View style={styles.sources}>
                    <BookSources sources={turn.sources} onNavigate={onNavigateSource} />
                  </View>
                ) : null}
              </View>
            </View>
          ),
        )}
        {isLoading ? (
          <View style={styles.thinking}>
            <Text style={styles.thinkingText}>Thinking…</Text>
          </View>
        ) : null}
      </ScrollView>

      {selectedText ? (
        <View style={styles.ctxChip}>
          <Text style={styles.ctxText} numberOfLines={1}>
            Asking about: "{selectedText}"
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear selection context"
            onPress={onClearSelection}
          >
            <Text style={styles.ctxClear}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask a follow-up…"
          placeholderTextColor="#a8a298"
          onSubmitEditing={handleSubmit}
          returnKeyType="send"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={handleSubmit}
          style={styles.send}
        >
          <Text style={styles.sendIcon}>➤</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fffdf8',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderTopColor: '#e4dfd6',
    flex: 1,
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d7d2c8',
    alignSelf: 'center',
    marginTop: 9,
    marginBottom: 4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e4dfd6',
  },
  title: {
    fontWeight: '800',
    fontSize: 15,
    color: '#171715',
  },
  headRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#244f38',
  },
  switch: {
    width: 38,
    height: 22,
    borderRadius: 12,
    justifyContent: 'center',
  },
  switchOn: {
    backgroundColor: '#244f38',
    alignItems: 'flex-end',
  },
  switchOff: {
    backgroundColor: '#c9c4ba',
    alignItems: 'flex-start',
  },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    marginHorizontal: 2,
  },
  knobOn: {},
  knobOff: {},
  iconButton: {
    paddingHorizontal: 2,
  },
  trash: {
    color: '#78746d',
    fontSize: 13,
    fontWeight: '600',
  },
  close: {
    color: '#78746d',
    fontSize: 15,
  },
  convo: {
    flex: 1,
  },
  convoContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  turn: {
    marginBottom: 16,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 16,
  },
  userBubble: {
    backgroundColor: '#244f38',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 13,
    maxWidth: '80%',
  },
  userText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  answer: {
    backgroundColor: '#f7f1dd',
    borderWidth: 1,
    borderColor: '#e7dcb8',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  answerText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#171715',
  },
  sources: {
    marginTop: 12,
  },
  thinking: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  thinkingText: {
    color: '#78746d',
    fontSize: 13,
    fontStyle: 'italic',
  },
  ctxChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#edf3e9',
    borderWidth: 1,
    borderColor: '#cfe0d2',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginHorizontal: 14,
    marginBottom: 8,
  },
  ctxText: {
    flex: 1,
    color: '#2c5a40',
    fontSize: 12,
  },
  ctxClear: {
    color: '#5d7c66',
    fontWeight: '700',
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#e4dfd6',
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4dfd6',
    borderRadius: 22,
    paddingVertical: 11,
    paddingHorizontal: 15,
    fontSize: 14,
    color: '#171715',
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#244f38',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIcon: {
    color: '#fff',
    fontSize: 16,
  },
});
