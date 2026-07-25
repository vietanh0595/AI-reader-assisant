import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Bookmark, Check, Copy, MessageCircle, Pencil } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ConversationTurn } from '../library/conversation';
import { AnswerMarkdown } from './AnswerMarkdown';
import { BookSources } from './BookSources';

type ConversationThreadProps = {
  turns: ConversationTurn[];
  includeWholeBook: boolean;
  selectedText?: string;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSubmit: (text: string, context?: { quotedText: string; quotedTurnId?: string }) => void;
  onToggleWholeBook: () => void;
  onClear: () => void;
  onNavigateSource: (paragraphId: string, excerpt?: string) => void;
  onClearSelection: () => void;
  onClose: () => void;
  onSaveTurn: (turn: ConversationTurn) => void;
  savedTurnIds: Set<string>;
};

export function ConversationThread({
  turns,
  includeWholeBook,
  selectedText,
  isLoading,
  error,
  onSubmit,
  onRetry,
  onToggleWholeBook,
  onClear,
  onNavigateSource,
  onClearSelection,
  onClose,
  onSaveTurn,
  savedTurnIds,
}: ConversationThreadProps) {
  const [draft, setDraft] = useState('');
  const [quotedText, setQuotedText] = useState<string | undefined>(selectedText);
  const [quotedTurnId, setQuotedTurnId] = useState<string | undefined>(undefined);
  const [menuTurn, setMenuTurn] = useState<ConversationTurn | null>(null);
  const [userMenuTurn, setUserMenuTurn] = useState<ConversationTurn | null>(null);
  const [menuY, setMenuY] = useState(0);
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null);
  const highlightAnim = useRef(new Animated.Value(0)).current;
  const dotAnims = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  const inputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const sheetRef = useRef<View>(null);
  const sheetOffsetY = useRef(0);
  const turnPositions = useRef<Record<string, number>>({});
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  // Only show chip for explicit in-thread quotes (long-press); book selection is injected silently.
  const activeChip = quotedText;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // The sheet sits inside the app SafeAreaView, whose bottom inset already lifts
  // it above the home indicator; subtract it so we don't double-count.
  const keyboardPadding = keyboardHeight > 0 ? Math.max(0, keyboardHeight - insets.bottom) : 0;

  // Scroll to end on mount so thread opens at latest message.
  useEffect(() => {
    const t = setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(t);
  }, []);

  // Auto-scroll when a new turn arrives, but only if user was already at the bottom.
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length]);

  useEffect(() => {
    if (!isLoading) {
      dotAnims.forEach((a) => { a.stopAnimation(); a.setValue(0); });
      return;
    }
    const loops = dotAnims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(anim, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 280, useNativeDriver: true }),
          Animated.delay(500),
        ]),
      ),
    );
    Animated.parallel(loops).start();
    return () => loops.forEach((l) => l.stop());
  }, [isLoading]);

  function triggerHighlight(turnId: string) {
    setHighlightedTurnId(turnId);
    highlightAnim.setValue(1);
    Animated.timing(highlightAnim, {
      toValue: 0,
      duration: 1200,
      useNativeDriver: true,
    }).start(() => setHighlightedTurnId(null));
  }

  function handleLongPressAssistant(turn: ConversationTurn, pageY: number) {
    Haptics.selectionAsync().catch(() => {});
    triggerHighlight(turn.id);
    const MENU_HEIGHT = 90;
    const relativeY = pageY - sheetOffsetY.current - MENU_HEIGHT - 48;
    setMenuY(Math.max(60, relativeY));
    setMenuTurn(turn);
  }

  function dismissMenu() { setMenuTurn(null); setUserMenuTurn(null); }

  function handleLongPressUser(turn: ConversationTurn, pageY: number) {
    Haptics.selectionAsync().catch(() => {});
    const MENU_HEIGHT = 90;
    const relativeY = pageY - sheetOffsetY.current - MENU_HEIGHT - 48;
    setMenuY(Math.max(60, relativeY));
    setUserMenuTurn(turn);
  }

  function handleUserMenuEdit() {
    if (!userMenuTurn) return;
    setDraft(userMenuTurn.text);
    dismissMenu();
    inputRef.current?.focus();
  }

  function handleUserMenuCopy() {
    if (!userMenuTurn) return;
    void Clipboard.setStringAsync(userMenuTurn.text);
    dismissMenu();
  }

  function handleMenuAsk() {
    if (!menuTurn) return;
    setQuotedText(menuTurn.text);
    setQuotedTurnId(menuTurn.id);
    dismissMenu();
    inputRef.current?.focus();
  }

  function handleMenuCopy() {
    if (!menuTurn) return;
    void Clipboard.setStringAsync(menuTurn.text);
    dismissMenu();
  }

  function handleMenuSave() {
    if (!menuTurn || savedTurnIds.has(menuTurn.id)) return;
    onSaveTurn(menuTurn);
    dismissMenu();
  }

  function scrollToTurn(turnId: string) {
    const y = turnPositions.current[turnId];
    if (y !== undefined) {
      scrollViewRef.current?.scrollTo({ y, animated: true });
    }
  }

  const handleSubmit = () => {
    if (isLoading) {
      return;
    }
    const text = draft.trim();
    if (!text) {
      return;
    }
    setDraft('');
    isAtBottomRef.current = true;
    onSubmit(text, activeChip ? { quotedText: activeChip, quotedTurnId } : undefined);
    onClearSelection();
    setQuotedText(undefined);
    setQuotedTurnId(undefined);
    // Delay slightly so the optimistic user turn renders before we scroll.
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 30);
  };

  return (
    <View
      ref={sheetRef}
      style={[styles.sheet, { paddingBottom: keyboardPadding }]}
      onLayout={() => {
        sheetRef.current?.measureInWindow((_, y) => { sheetOffsetY.current = y; });
      }}
    >
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

      <ScrollView
        ref={scrollViewRef}
        style={styles.convo}
        contentContainerStyle={styles.convoContent}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
          const atBottom = distanceFromBottom < 40;
          isAtBottomRef.current = atBottom;
          setIsAtBottom(atBottom);
        }}
      >
        {turns.map((turn) =>
          turn.role === 'user' ? (
            <View
              key={turn.id}
              style={styles.userRow}
              onLayout={(e) => { turnPositions.current[turn.id] = e.nativeEvent.layout.y; }}
            >
              <Pressable
                style={styles.userBubble}
                onPress={() => Keyboard.dismiss()}
                onLongPress={(e) => handleLongPressUser(turn, e.nativeEvent.pageY)}
                delayLongPress={400}
                accessibilityHint="Long press to copy or edit this message"
              >
                <Text style={styles.userText}>{turn.text}</Text>
                {turn.selectedText ? (
                  <Pressable
                    style={styles.ctxQuote}
                    accessibilityRole={turn.contextParagraphId || turn.contextTurnId ? 'button' : 'none'}
                    accessibilityLabel={
                      turn.contextParagraphId ? 'Go to context passage' :
                      turn.contextTurnId ? 'Scroll to quoted response' : undefined
                    }
                    onPress={
                      turn.contextParagraphId
                        ? () => { Keyboard.dismiss(); onNavigateSource(turn.contextParagraphId!, turn.selectedText); }
                        : turn.contextTurnId
                        ? () => { Keyboard.dismiss(); scrollToTurn(turn.contextTurnId!); }
                        : undefined
                    }
                  >
                    <View style={styles.ctxBar} />
                    <View style={styles.ctxQuoteBody}>
                      <Text style={styles.ctxQuoteLabel}>
                        {turn.contextParagraphId || turn.contextTurnId ? 'Context · tap to jump ↗' : 'Context'}
                      </Text>
                      <Text style={styles.ctxQuoteText} numberOfLines={2}>
                        {turn.selectedText}
                      </Text>
                    </View>
                  </Pressable>
                ) : null}
              </Pressable>
            </View>
          ) : (
            <View
              key={turn.id}
              style={styles.turn}
              onLayout={(e) => { turnPositions.current[turn.id] = e.nativeEvent.layout.y; }}
            >
              <Pressable
                style={styles.answer}
                onPress={() => Keyboard.dismiss()}
                onLongPress={(e) => handleLongPressAssistant(turn, e.nativeEvent.pageY)}
                delayLongPress={400}
                accessibilityHint="Long press to quote this answer"
              >
                {highlightedTurnId === turn.id && (
                  <Animated.View
                    style={[StyleSheet.absoluteFill, styles.highlight, { opacity: highlightAnim }]}
                    pointerEvents="none"
                  />
                )}
                <AnswerMarkdown text={turn.text} />
                {turn.sources && turn.sources.length > 0 ? (
                  <View style={styles.sources}>
                    <BookSources sources={turn.sources} onNavigate={(id, excerpt) => { Keyboard.dismiss(); onNavigateSource(id, excerpt); }} />
                  </View>
                ) : null}
              </Pressable>
            </View>
          ),
        )}
        {isLoading ? (
          <View style={styles.thinkingRow}>
            <View style={styles.thinkingBubble}>
              {dotAnims.map((anim, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.thinkingDot,
                    {
                      opacity: anim,
                      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {!isAtBottom ? (
        <Pressable
          style={[styles.scrollToLatest, { bottom: activeChip ? 122 : 80 }]}
          onPress={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
          accessibilityRole="button"
          accessibilityLabel="Scroll to latest"
        >
          <Text style={styles.scrollToLatestText}>↓ Latest</Text>
        </Pressable>
      ) : null}

      {activeChip ? (
        <View style={styles.ctxChip}>
          <Text style={styles.ctxText} numberOfLines={1}>
            Asking about: "{activeChip}"
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear selection context"
            onPress={() => { onClearSelection(); setQuotedText(undefined); }}
          >
            <Text style={styles.ctxClear}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {error && !isLoading ? (
        <View style={styles.errorRow}>
          <Text style={styles.errorText}>Couldn't get a response.</Text>
          <Text style={styles.errorDetail}>{error}</Text>
          {onRetry ? (
            <Pressable onPress={onRetry} style={styles.retryButton} accessibilityRole="button">
              <Text style={styles.retryText}>↺ Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
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
          accessibilityState={{ disabled: isLoading }}
          onPress={handleSubmit}
          style={[styles.send, isLoading ? styles.sendDisabled : null]}
        >
          <Text style={styles.sendIcon}>➤</Text>
        </Pressable>
      </View>

      {menuTurn ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissMenu}>
          <View
            style={[styles.menuCard, { top: menuY }]}
            onStartShouldSetResponder={() => true}
          >
            <Pressable style={styles.menuItem} onPress={handleMenuAsk}>
              <MessageCircle size={22} color="#244f38" strokeWidth={1.8} />
              <Text style={styles.menuItemLabel}>Ask about this</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={handleMenuSave}>
              {menuTurn && savedTurnIds.has(menuTurn.id) ? (
                <Check size={22} color="#244f38" strokeWidth={1.8} />
              ) : (
                <Bookmark size={22} color="#5c5750" strokeWidth={1.8} />
              )}
              <Text style={styles.menuItemLabel}>
                {menuTurn && savedTurnIds.has(menuTurn.id) ? 'Saved' : 'Save'}
              </Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={handleMenuCopy}>
              <Copy size={22} color="#5c5750" strokeWidth={1.8} />
              <Text style={styles.menuItemLabel}>Copy</Text>
            </Pressable>
          </View>
        </Pressable>
      ) : null}

      {userMenuTurn ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissMenu}>
          <View
            style={[styles.menuCard, { top: menuY }]}
            onStartShouldSetResponder={() => true}
          >
            <Pressable style={styles.menuItem} onPress={handleUserMenuEdit}>
              <Pencil size={22} color="#244f38" strokeWidth={1.8} />
              <Text style={styles.menuItemLabel}>Edit & resend</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={handleUserMenuCopy}>
              <Copy size={22} color="#5c5750" strokeWidth={1.8} />
              <Text style={styles.menuItemLabel}>Copy</Text>
            </Pressable>
          </View>
        </Pressable>
      ) : null}
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
  ctxQuote: {
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.3)',
    paddingTop: 7,
    flexDirection: 'row',
    gap: 6,
  },
  ctxBar: {
    width: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  ctxQuoteBody: {
    flex: 1,
  },
  ctxQuoteLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  ctxQuoteText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 16,
    fontStyle: 'italic',
  },
  answer: {
    backgroundColor: '#f7f1dd',
    borderWidth: 1,
    borderColor: '#e7dcb8',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  sources: {
    marginTop: 12,
  },
  thinkingRow: {
    paddingHorizontal: 18,
    paddingVertical: 6,
    alignItems: 'flex-start',
  },
  thinkingBubble: {
    backgroundColor: '#f0ece4',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#9c9289',
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
  errorRow: {
    backgroundColor: '#fbeaea',
    borderColor: '#e6c3c3',
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'column',
  },
  errorText: {
    color: '#9c2f2f',
    fontSize: 13,
    fontWeight: '600',
  },
  errorDetail: {
    color: '#b06060',
    fontSize: 12,
    marginTop: 2,
  },
  retryButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#9c2f2f',
    borderRadius: 10,
  },
  retryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
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
  sendDisabled: {
    backgroundColor: '#a8a298',
  },
  sendIcon: {
    color: '#fff',
    fontSize: 16,
  },
  menuCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4dfd6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 8,
    overflow: 'hidden',
  },
  menuItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 7,
  },
  menuDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: '#e4dfd6',
    marginVertical: 12,
  },
  menuItemLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#2e2b28',
  },
  highlight: {
    backgroundColor: '#fde8b4',
    borderRadius: 13,
  },
  scrollToLatest: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: '#244f38',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  scrollToLatestText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
