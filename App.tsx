import * as Clipboard from 'expo-clipboard';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  HelpCircle,
  List,
  LucideProps,
  MessageCircle,
  MoreHorizontal,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Type,
} from 'lucide-react-native';
import { ComponentType, useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

type QuickAction = 'explain' | 'example' | 'rephrase' | 'ask';
type FollowUpAction = 'simpler';
type InsightAction = QuickAction | FollowUpAction;
type AppIcon = ComponentType<LucideProps>;
type SelectionKind = 'word' | 'phrase' | 'paragraph';

type PassageSegment = {
  id: string;
  paragraphId: string;
  selectionKind?: SelectionKind;
  text: string;
};

type Paragraph = {
  id: string;
  segments: PassageSegment[];
};

type ReaderSelection = {
  id: string;
  paragraphId: string;
  selectionKind: SelectionKind;
  text: string;
};

type Insight = {
  eyebrow: string;
  body: string;
};

type ReaderMessage =
  | {
      paragraphId: string;
      selectionKind: SelectionKind;
      text: string;
      type: 'selection';
    }
  | {
      type: 'clearSelection';
    };

const quickActions: Array<{ action: QuickAction; icon: AppIcon; label: string }> = [
  { action: 'explain', icon: Sparkles, label: 'Explain' },
  { action: 'example', icon: BookOpen, label: 'Example' },
  { action: 'rephrase', icon: MessageCircle, label: 'Rephrase' },
  { action: 'ask', icon: HelpCircle, label: 'Ask' },
];

const book = {
  author: 'Daniel Kahneman',
  page: 'Page 112 of 499',
  progress: '22%',
  title: 'Thinking, Fast and Slow',
};

const paragraphs: Paragraph[] = [
  {
    id: 'p1',
    segments: [
      {
        id: 'judgments',
        paragraphId: 'p1',
        selectionKind: 'paragraph',
        text:
          'Our judgments and choices usually make sense to us. We see what we expect to see; we notice what we are prepared to notice; we interpret things in a way that makes sense in light of our experience.',
      },
    ],
  },
  {
    id: 'p2',
    segments: [
      {
        id: 'surprise',
        paragraphId: 'p2',
        selectionKind: 'paragraph',
        text:
          'But there are also times when we are surprised by our own behavior, times when we do things that seem odd, given what we know and believe.',
      },
    ],
  },
  {
    id: 'p3',
    segments: [
      {
        id: 'extrapolation-prefix',
        paragraphId: 'p3',
        text: 'One of the most pervasive influences on our judgments is our tendency to ',
      },
      {
        id: 'extrapolate-word',
        paragraphId: 'p3',
        selectionKind: 'word',
        text: 'extrapolate',
      },
      {
        id: 'extrapolation-bridge',
        paragraphId: 'p3',
        text: '. ',
      },
      {
        id: 'present-future-phrase',
        paragraphId: 'p3',
        selectionKind: 'phrase',
        text: 'We project the present into the future and the future into the present.',
      },
    ],
  },
  {
    id: 'p4',
    segments: [
      {
        id: 'overconfidence',
        paragraphId: 'p4',
        selectionKind: 'paragraph',
        text:
          'This tendency is not always misguided, but it often leads to overconfidence and systematic errors.',
      },
    ],
  },
  {
    id: 'p5',
    segments: [
      {
        id: 'systems',
        paragraphId: 'p5',
        selectionKind: 'paragraph',
        text:
          'Understanding the two systems that drive our thinking--System 1 and System 2--can help us recognize these errors and make better decisions.',
      },
    ],
  },
];

const primaryInsights: Record<string, Record<InsightAction, Insight>> = {
  'extrapolate-word': {
    explain: {
      eyebrow: 'Definition',
      body:
        'To extrapolate means to use what you know now to guess beyond the evidence, especially about what will happen later.',
    },
    example: {
      eyebrow: 'Example',
      body: 'If today is unusually hot, you might assume the whole month will be hot. That is extrapolating.',
    },
    rephrase: {
      eyebrow: 'Use in this sentence',
      body: 'Here, extrapolate means extending a current pattern into a broader prediction.',
    },
    ask: {
      eyebrow: 'Follow-up',
      body: 'A useful question is: what evidence is the reader using to project beyond what is directly known?',
    },
    simpler: {
      eyebrow: 'Simpler',
      body: 'It means guessing a bigger pattern from a small piece of evidence.',
    },
  },
  'present-future-phrase': {
    explain: {
      eyebrow: 'Short version',
      body:
        'We tend to assume today will continue tomorrow. We extend patterns forward and backward in time, which can lead to big mistakes.',
    },
    example: {
      eyebrow: 'Example',
      body:
        'If a stock has risen for five days, we may expect it to keep rising, even when those five days tell us very little about what happens next.',
    },
    rephrase: {
      eyebrow: 'Rephrased',
      body:
        'People often use what is happening now as their best guess for what happened before and what will happen later.',
    },
    ask: {
      eyebrow: 'Follow-up',
      body:
        'A useful question is: when does projecting from the present help us, and when does it mislead us?',
    },
    simpler: {
      eyebrow: 'Simpler',
      body: 'We often expect the future to look like the present, even when that is a weak guess.',
    },
  },
};

function getInsight(selection: ReaderSelection, action: InsightAction, askedQuestion: string): Insight {
  if (action === 'ask' && askedQuestion) {
    return {
      eyebrow: 'Answer',
      body: `For "${askedQuestion}", the key idea is that the author is warning against treating the present as proof of a stable pattern.`,
    };
  }

  const savedInsight = primaryInsights[selection.id]?.[action];

  if (savedInsight) {
    return savedInsight;
  }

  const fallbackByAction: Record<InsightAction, Insight> = {
    ask: {
      eyebrow: 'Follow-up',
      body: 'A useful follow-up is: what assumption does this selection need me to accept?',
    },
    example: {
      eyebrow: 'Example',
      body:
        'It is like assuming a calm week means a calm year. The recent pattern feels meaningful, but it may only be a small sample.',
    },
    explain: {
      eyebrow: selection.selectionKind === 'word' ? 'Definition' : 'Short version',
      body:
        selection.selectionKind === 'word'
          ? 'This word is doing important conceptual work in the passage.'
          : 'The selected passage is compressing a larger claim into a compact statement.',
    },
    rephrase: {
      eyebrow: 'Rephrased',
      body: `In simpler words: ${selection.text}`,
    },
    simpler: {
      eyebrow: 'Simpler',
      body: 'The author is saying this idea needs to be slowed down.',
    },
  };

  return fallbackByAction[action];
}

function getParagraphText(paragraph: Paragraph) {
  return paragraph.segments.map((segment) => segment.text).join('');
}

function normalizeSelectionText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function inferSelectionKind(text: string): SelectionKind {
  const normalizedText = normalizeSelectionText(text);

  if (!normalizedText.includes(' ')) {
    return 'word';
  }

  return normalizedText.length > 90 ? 'paragraph' : 'phrase';
}

function findKnownSegmentForSelection(selectedText: string) {
  const normalizedSelection = normalizeSelectionText(selectedText);

  if (!normalizedSelection) {
    return null;
  }

  return (
    paragraphs
      .flatMap((paragraph) => paragraph.segments)
      .find((segment) => normalizeSelectionText(segment.text) === normalizedSelection) ?? null
  );
}

function getParagraphById(paragraphId: string) {
  return paragraphs.find((paragraph) => paragraph.id === paragraphId) ?? null;
}

function stopPressPropagation(event: unknown) {
  const pressEvent = event as { stopPropagation?: () => void };
  pressEvent.stopPropagation?.();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createReaderHtml() {
  const body = paragraphs
    .map((paragraph) => `<p data-paragraph-id="${paragraph.id}">${escapeHtml(getParagraphText(paragraph))}</p>`)
    .join('\n');

  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      :root {
        color-scheme: light;
        -webkit-text-size-adjust: 100%;
      }

      html,
      body {
        background: #fffdf8;
        margin: 0;
        padding: 0;
      }

      body {
        color: #171715;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 16px;
        line-height: 1.58;
        padding: 10px 27px 136px;
        -webkit-touch-callout: none;
        -webkit-user-select: text;
        user-select: text;
      }

      p {
        margin: 0 0 22px;
        -webkit-touch-callout: none;
        -webkit-user-select: text;
        user-select: text;
      }

      ::selection {
        background: #cfdec8;
        color: #171715;
      }
    </style>
  </head>
  <body>
    ${body}
    <script>
      (function () {
        function normalize(text) {
          return (text || '').replace(/\\s+/g, ' ').trim();
        }

        function inferSelectionKind(text) {
          var normalized = normalize(text);

          if (normalized.indexOf(' ') === -1) {
            return 'word';
          }

          return normalized.length > 90 ? 'paragraph' : 'phrase';
        }

        function closestParagraph(node) {
          var element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

          while (element && element !== document.body) {
            if (element.dataset && element.dataset.paragraphId) {
              return element;
            }

            element = element.parentElement;
          }

          return null;
        }

        function postSelection() {
          var selection = window.getSelection();

          if (!selection || selection.rangeCount === 0) {
            return;
          }

          var text = normalize(selection.toString());

          if (!text) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'clearSelection' }));
            return;
          }

          var range = selection.getRangeAt(0);
          var paragraph = closestParagraph(range.commonAncestorContainer) || closestParagraph(selection.anchorNode);

          if (!paragraph) {
            return;
          }

          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'selection',
            paragraphId: paragraph.dataset.paragraphId,
            selectionKind: inferSelectionKind(text),
            text: text
          }));
        }

        var timer;
        function schedulePostSelection() {
          clearTimeout(timer);
          timer = setTimeout(postSelection, 160);
        }

        document.addEventListener('selectionchange', schedulePostSelection);
        document.addEventListener('mouseup', schedulePostSelection);
        document.addEventListener('touchend', schedulePostSelection);
      })();
    </script>
  </body>
</html>`;
}

export default function App() {
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [selectedAction, setSelectedAction] = useState<InsightAction | null>(null);
  const [savedInsightIds, setSavedInsightIds] = useState<string[]>([]);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [askedQuestion, setAskedQuestion] = useState('');
  const readerHtml = useMemo(createReaderHtml, []);

  const visibleInsight = selection && selectedAction ? getInsight(selection, selectedAction, askedQuestion) : null;
  const insightId = selection && selectedAction ? `${selection.id}:${selectedAction}` : null;
  const isSaved = insightId ? savedInsightIds.includes(insightId) : false;

  function clearSelection() {
    setSelection(null);
    setSelectedAction(null);
    setIsAskOpen(false);
    setAskedQuestion('');
    setQuestion('');
  }

  function setSelectionFromReader(text: string, paragraphId: string, selectionKind: SelectionKind) {
    const normalizedText = normalizeSelectionText(text);
    const knownSegment = findKnownSegmentForSelection(normalizedText);

    if (!normalizedText) {
      clearSelection();
      return;
    }

    setSelection({
      id: knownSegment?.id ?? `selection:${paragraphId}:${normalizedText}`,
      paragraphId: knownSegment?.paragraphId ?? paragraphId,
      selectionKind: knownSegment?.selectionKind ?? selectionKind,
      text: normalizedText,
    });
    setSelectedAction(null);
    setIsAskOpen(false);
    setAskedQuestion('');
  }

  const handleReaderMessage = useCallback((message: ReaderMessage) => {
    if (message.type === 'clearSelection') {
      clearSelection();
      return;
    }

    setSelectionFromReader(message.text, message.paragraphId, message.selectionKind);
  }, []);

  function chooseAction(action: QuickAction) {
    if (action === 'ask') {
      setIsAskOpen(true);
      setSelectedAction('ask');
      return;
    }

    setSelectedAction(action);
    setIsAskOpen(false);
  }

  function saveInsight() {
    if (!insightId || isSaved) {
      return;
    }

    setSavedInsightIds((currentIds) => [...currentIds, insightId]);
  }

  function submitQuestion() {
    setAskedQuestion(question.trim());
    setSelectedAction('ask');
    setIsAskOpen(false);
    setQuestion('');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={[styles.phoneShell, Platform.OS !== 'web' && styles.nativeShell]}>
        <View style={styles.readerScreen}>
          <ReaderHeader />

          <ReaderSurface
            html={readerHtml}
            onClearSelection={clearSelection}
            onSelectionMessage={handleReaderMessage}
          />

          {selection ? (
            <SelectionPanel
              activeAction={selectedAction}
              insight={visibleInsight}
              isSaved={isSaved}
              onAskMore={() => setIsAskOpen(true)}
              onChooseAction={chooseAction}
              onMakeSimpler={() => setSelectedAction('simpler')}
              onSave={saveInsight}
              selectionKind={selection.selectionKind}
            />
          ) : null}

          <ReaderFooter savedCount={savedInsightIds.length} />

          {isAskOpen && selection ? (
            <AskSheet
              question={question}
              selectedText={selection.text}
              onChangeQuestion={setQuestion}
              onClose={() => setIsAskOpen(false)}
              onSubmit={submitQuestion}
            />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

function ReaderSurface({
  html,
  onClearSelection,
  onSelectionMessage,
}: {
  html: string;
  onClearSelection: () => void;
  onSelectionMessage: (message: ReaderMessage) => void;
}) {
  if (Platform.OS === 'web') {
    return <WebFallbackReader onClearSelection={onClearSelection} onSelectionMessage={onSelectionMessage} />;
  }

  function handleMessage(event: WebViewMessageEvent) {
    try {
      onSelectionMessage(JSON.parse(event.nativeEvent.data) as ReaderMessage);
    } catch {
      // Ignore malformed WebView messages. The reader should not crash because of injected JS.
    }
  }

  return (
    <WebView
      automaticallyAdjustContentInsets={false}
      bounces
      javaScriptEnabled
      menuItems={[{ key: 'copy-selection', label: 'Copy' }]}
      onCustomMenuSelection={(event) => {
        void Clipboard.setStringAsync(event.nativeEvent.selectedText);
      }}
      onMessage={handleMessage}
      originWhitelist={['*']}
      scrollEnabled
      source={{ html }}
      suppressMenuItems={[
        'cut',
        'paste',
        'replace',
        'bold',
        'italic',
        'underline',
        'select',
        'selectAll',
        'translate',
        'lookup',
        'share',
      ]}
      style={styles.webView}
    />
  );
}

function WebFallbackReader({
  onClearSelection,
  onSelectionMessage,
}: {
  onClearSelection: () => void;
  onSelectionMessage: (message: ReaderMessage) => void;
}) {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined;
    }

    let selectionTimer: ReturnType<typeof setTimeout> | undefined;

    function handleSelection() {
      if (selectionTimer) {
        clearTimeout(selectionTimer);
      }

      selectionTimer = setTimeout(() => {
        const selectedText = normalizeSelectionText(window.getSelection?.()?.toString() ?? '');

        if (!selectedText) {
          return;
        }

        const paragraph =
          paragraphs.find((candidate) =>
            normalizeSelectionText(getParagraphText(candidate)).includes(selectedText),
          ) ?? null;

        if (!paragraph) {
          return;
        }

        onSelectionMessage({
          paragraphId: paragraph.id,
          selectionKind: inferSelectionKind(selectedText),
          text: selectedText,
          type: 'selection',
        });
      }, 0);
    }

    document.addEventListener('selectionchange', handleSelection);
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);

    return () => {
      if (selectionTimer) {
        clearTimeout(selectionTimer);
      }

      document.removeEventListener('selectionchange', handleSelection);
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('touchend', handleSelection);
    };
  }, [onSelectionMessage]);

  return (
    <Pressable accessible={false} onPress={onClearSelection} style={styles.readingLayer}>
      <ScrollView
        contentContainerStyle={styles.readingContent}
        scrollIndicatorInsets={{ bottom: 88 }}
        showsVerticalScrollIndicator={false}
      >
        {paragraphs.map((paragraph) => (
          <View key={paragraph.id} style={styles.paragraphBlock}>
            <Text selectable style={styles.paragraph}>
              {getParagraphText(paragraph)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Pressable>
  );
}

function ReaderHeader() {
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="Back" accessibilityRole="button" style={styles.headerIconButton}>
        <ArrowLeft color={colors.ink} size={20} strokeWidth={2} />
      </Pressable>

      <View style={styles.titleBlock}>
        <Text numberOfLines={1} style={styles.bookTitle}>
          {book.title}
        </Text>
        <Text numberOfLines={1} style={styles.authorName}>
          {book.author}
        </Text>
      </View>

      <View style={styles.headerTools}>
        <Pressable accessibilityLabel="Text settings" accessibilityRole="button" style={styles.headerIconButton}>
          <Type color={colors.ink} size={19} strokeWidth={2} />
        </Pressable>
        <Pressable accessibilityLabel="More options" accessibilityRole="button" style={styles.headerIconButton}>
          <MoreHorizontal color={colors.ink} size={20} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  );
}

function ReaderFooter({ savedCount }: { savedCount: number }) {
  return (
    <View style={styles.footer}>
      <View style={styles.progressMeta}>
        <Text style={styles.pageText}>{book.page}</Text>
        <Text style={styles.pageText}>{book.progress}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={styles.progressFill} />
        <View style={styles.progressThumb} />
      </View>
      <View style={styles.bottomNav}>
        <Pressable accessibilityLabel="Table of contents" accessibilityRole="button" style={styles.bottomIcon}>
          <List color={colors.ink} size={21} strokeWidth={2} />
        </Pressable>
        <Pressable accessibilityLabel={`${savedCount} saved notes`} accessibilityRole="button" style={styles.bottomIcon}>
          <Bookmark color={colors.ink} size={21} strokeWidth={2} />
          {savedCount > 0 ? (
            <View style={styles.savedBadge}>
              <Text style={styles.savedBadgeText}>{savedCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable accessibilityLabel="Search" accessibilityRole="button" style={styles.bottomIcon}>
          <Search color={colors.ink} size={21} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  );
}

function SelectionPanel({
  activeAction,
  insight,
  isSaved,
  onAskMore,
  onChooseAction,
  onMakeSimpler,
  onSave,
  selectionKind,
}: {
  activeAction: InsightAction | null;
  insight: Insight | null;
  isSaved: boolean;
  onAskMore: () => void;
  onChooseAction: (action: QuickAction) => void;
  onMakeSimpler: () => void;
  onSave: () => void;
  selectionKind: SelectionKind;
}) {
  return (
    <Pressable accessible={false} onPress={stopPressPropagation} style={styles.selectionPanel}>
      <QuickActionMenu activeAction={activeAction} onChooseAction={onChooseAction} selectionKind={selectionKind} />

      {insight ? (
        <InsightCard
          insight={insight}
          isSaved={isSaved}
          onAskMore={onAskMore}
          onMakeSimpler={onMakeSimpler}
          onSave={onSave}
        />
      ) : null}
    </Pressable>
  );
}

function QuickActionMenu({
  activeAction,
  onChooseAction,
  selectionKind,
}: {
  activeAction: InsightAction | null;
  onChooseAction: (action: QuickAction) => void;
  selectionKind: SelectionKind;
}) {
  return (
    <View style={styles.actionMenu}>
      {quickActions.map(({ action, icon: Icon, label }) => {
        const isActive = activeAction === action;
        const visibleLabel = action === 'explain' && selectionKind === 'word' ? 'Define' : label;

        return (
          <Pressable
            key={action}
            accessibilityRole="button"
            onPress={() => onChooseAction(action)}
            style={({ pressed }) => [
              styles.actionButton,
              isActive && styles.actionButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Icon color={isActive ? colors.sageDark : colors.ink} size={20} strokeWidth={1.8} />
            <Text style={[styles.actionText, isActive && styles.actionTextActive]}>{visibleLabel}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InsightCard({
  insight,
  isSaved,
  onAskMore,
  onMakeSimpler,
  onSave,
}: {
  insight: Insight;
  isSaved: boolean;
  onAskMore: () => void;
  onMakeSimpler: () => void;
  onSave: () => void;
}) {
  return (
    <View style={styles.insightCard}>
      <View style={styles.insightHeader}>
        <Sparkles color={colors.clay} size={17} strokeWidth={2} />
        <Text style={styles.insightEyebrow}>{insight.eyebrow}</Text>
      </View>
      <Text style={styles.insightBody}>{insight.body}</Text>

      <View style={styles.insightActions}>
        <Pressable accessibilityRole="button" onPress={onMakeSimpler} style={styles.secondaryButton}>
          <SlidersHorizontal color={colors.ink} size={16} strokeWidth={2} />
          <Text style={styles.secondaryButtonText}>Simpler</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onAskMore} style={styles.secondaryButton}>
          <MessageCircle color={colors.ink} size={16} strokeWidth={2} />
          <Text style={styles.secondaryButtonText}>Ask more</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isSaved}
          onPress={onSave}
          style={[styles.secondaryButton, isSaved && styles.secondaryButtonSaved]}
        >
          <Bookmark color={isSaved ? colors.sageDark : colors.ink} size={16} strokeWidth={2} />
          <Text style={[styles.secondaryButtonText, isSaved && styles.savedButtonText]}>
            {isSaved ? 'Saved' : 'Save'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function AskSheet({
  question,
  selectedText,
  onChangeQuestion,
  onClose,
  onSubmit,
}: {
  question: string;
  selectedText: string;
  onChangeQuestion: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const canSubmit = question.trim().length > 0;

  return (
    <View style={styles.sheetLayer}>
      <Pressable accessibilityRole="button" style={styles.sheetScrim} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <View style={styles.askSheet}>
          <View style={styles.sheetHandle} />
          <Text numberOfLines={2} style={styles.selectedPreview}>
            {selectedText}
          </Text>
          <View style={styles.questionRow}>
            <TextInput
              multiline
              onChangeText={onChangeQuestion}
              placeholder="Ask a follow-up..."
              placeholderTextColor="#8c8a84"
              style={styles.questionInput}
              value={question}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={onSubmit}
              style={[styles.sendButton, !canSubmit && styles.sendButtonDisabled]}
            >
              <Send color={canSubmit ? colors.white : '#8c8a84'} size={18} strokeWidth={2.3} />
            </Pressable>
          </View>
          <View style={styles.sheetActions}>
            <Pressable accessibilityRole="button" onPress={onSubmit} style={styles.sheetButton}>
              <MessageCircle color={colors.ink} size={17} strokeWidth={2} />
              <Text style={styles.sheetButtonText}>Ask more</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.sheetButton}>
              <Bookmark color={colors.ink} size={17} strokeWidth={2} />
              <Text style={styles.sheetButtonText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const colors = {
  background: '#f3f1ec',
  card: '#ffffff',
  clay: '#8f6c3d',
  hairline: '#e4dfd6',
  ink: '#171715',
  mutedInk: '#6d6860',
  paper: '#fffdf8',
  sage: '#cfdec8',
  sageDark: '#244f38',
  shadow: '#191815',
  warmNote: '#fff0c8',
  warmNoteBorder: '#ead296',
  white: '#ffffff',
};

const readerFont = Platform.select({ default: 'Georgia', android: 'serif' });

const styles = StyleSheet.create({
  safeArea: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
  phoneShell: {
    backgroundColor: '#11110f',
    borderColor: '#050505',
    borderRadius: 42,
    borderWidth: 9,
    height: '92%',
    maxHeight: 880,
    maxWidth: 420,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    width: '94%',
  },
  nativeShell: {
    borderRadius: 0,
    borderWidth: 0,
    height: '100%',
    maxHeight: undefined,
    maxWidth: undefined,
    shadowOpacity: 0,
    width: '100%',
  },
  readerScreen: {
    backgroundColor: colors.paper,
    flex: 1,
    overflow: 'hidden',
  },
  webView: {
    backgroundColor: colors.paper,
    flex: 1,
  },
  readingLayer: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 74,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  headerIconButton: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  headerTools: {
    flexDirection: 'row',
  },
  titleBlock: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  bookTitle: {
    color: colors.ink,
    fontFamily: readerFont,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 18,
  },
  authorName: {
    color: colors.mutedInk,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 15,
  },
  readingContent: {
    paddingBottom: 136,
    paddingHorizontal: 27,
    paddingTop: 10,
  },
  paragraphBlock: {
    marginBottom: 22,
  },
  paragraph: {
    color: colors.ink,
    fontFamily: readerFont,
    fontSize: 16,
    letterSpacing: 0,
    lineHeight: 25,
  },
  selectionPanel: {
    backgroundColor: 'transparent',
    bottom: 106,
    left: 16,
    position: 'absolute',
    right: 16,
  },
  actionMenu: {
    backgroundColor: colors.card,
    borderColor: colors.hairline,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    shadowColor: colors.shadow,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.13,
    shadowRadius: 14,
    width: '100%',
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    gap: 5,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  actionButtonActive: {
    backgroundColor: '#edf3e9',
  },
  pressed: {
    opacity: 0.72,
  },
  actionText: {
    color: colors.ink,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 12,
  },
  actionTextActive: {
    color: colors.sageDark,
  },
  insightCard: {
    backgroundColor: colors.warmNote,
    borderColor: colors.warmNoteBorder,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
    shadowColor: colors.shadow,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  insightHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 9,
  },
  insightEyebrow: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  insightBody: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 18,
  },
  insightActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    borderColor: '#6f6758',
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  secondaryButtonSaved: {
    backgroundColor: '#e8f0e4',
    borderColor: colors.sageDark,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  savedButtonText: {
    color: colors.sageDark,
  },
  footer: {
    backgroundColor: colors.paper,
    bottom: 0,
    left: 0,
    paddingBottom: 18,
    paddingHorizontal: 27,
    paddingTop: 10,
    position: 'absolute',
    right: 0,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  pageText: {
    color: colors.mutedInk,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0,
  },
  progressTrack: {
    backgroundColor: '#c7c3ba',
    borderRadius: 999,
    height: 2,
    marginBottom: 20,
  },
  progressFill: {
    backgroundColor: colors.sageDark,
    borderRadius: 999,
    height: 2,
    width: '22%',
  },
  progressThumb: {
    backgroundColor: colors.sageDark,
    borderRadius: 999,
    height: 8,
    left: '21%',
    marginTop: -5,
    position: 'absolute',
    width: 8,
  },
  bottomNav: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bottomIcon: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 46,
  },
  savedBadge: {
    alignItems: 'center',
    backgroundColor: colors.sageDark,
    borderRadius: 999,
    height: 15,
    justifyContent: 'center',
    minWidth: 15,
    position: 'absolute',
    right: 9,
    top: 1,
  },
  savedBadgeText: {
    color: colors.white,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sheetLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 23, 21, 0.24)',
  },
  keyboardContainer: {
    width: '100%',
  },
  askSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 21,
    paddingHorizontal: 14,
    paddingTop: 9,
    shadowColor: colors.shadow,
    shadowOffset: { height: -8, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#d4d0c8',
    borderRadius: 999,
    height: 4,
    marginBottom: 16,
    width: 44,
  },
  selectedPreview: {
    color: colors.mutedInk,
    fontFamily: readerFont,
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 19,
    marginBottom: 10,
  },
  questionRow: {
    alignItems: 'center',
    borderColor: '#d6d3cc',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 62,
    paddingHorizontal: 10,
  },
  questionInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 19,
    maxHeight: 84,
    paddingVertical: 10,
    textAlignVertical: 'center',
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.sageDark,
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    marginLeft: 8,
    width: 28,
  },
  sendButtonDisabled: {
    backgroundColor: '#d8d6d0',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  sheetButton: {
    alignItems: 'center',
    borderColor: '#d0cbc1',
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 43,
  },
  sheetButtonText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
