import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Copy as CopyIcon,
  HelpCircle,
  List,
  LucideProps,
  MessageCircle,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Type,
  Upload,
} from 'lucide-react-native';
import { ComponentType, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  NativeModules,
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
import { parseEpubAsset, ParsedEpubBook } from './epub';

type QuickAction = 'explain' | 'example' | 'rephrase' | 'ask';
type ClipboardAction = 'copy';
type SelectionAction = QuickAction | ClipboardAction;
type FollowUpAction = 'simpler';
type InsightAction = QuickAction | FollowUpAction;
type AppIcon = ComponentType<LucideProps>;
type SelectionKind = 'word' | 'phrase' | 'paragraph';
type ReaderBlockKind =
  | 'body'
  | 'chapterNumber'
  | 'chapterTitle'
  | 'sectionHeading'
  | 'subheading'
  | 'quote'
  | 'listItem';

type PassageSegment = {
  id: string;
  paragraphId: string;
  selectionKind?: SelectionKind;
  text: string;
};

type Paragraph = {
  blockKind?: ReaderBlockKind;
  id: string;
  segments: PassageSegment[];
};

type ReaderChapter = {
  id: string;
  paragraphId: string;
  title: string;
};

type ReaderBook = {
  author: string;
  chapters: ReaderChapter[];
  fileName?: string;
  page: string;
  paragraphs: Paragraph[];
  progress: string;
  source: 'epub' | 'sample';
  title: string;
};

type ScrollTarget = {
  nonce: number;
  paragraphId: string;
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

type AssistRequestPayload = {
  action: InsightAction;
  author: string;
  bookTitle: string;
  paragraphText: string;
  question?: string;
  selectedText: string;
  selectionKind: SelectionKind;
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

const selectionActions: Array<{ action: SelectionAction; icon: AppIcon; label: string }> = [
  { action: 'explain', icon: Sparkles, label: 'Explain' },
  { action: 'example', icon: BookOpen, label: 'Example' },
  { action: 'rephrase', icon: MessageCircle, label: 'Rephrase' },
  { action: 'ask', icon: HelpCircle, label: 'Ask' },
  { action: 'copy', icon: CopyIcon, label: 'Copy' },
];

const sampleBookMetadata = {
  author: 'Daniel Kahneman',
  page: 'Page 112 of 499',
  progress: '22%',
  title: 'Thinking, Fast and Slow',
};

const apiBaseUrl = getApiBaseUrl();

const sampleParagraphs: Paragraph[] = [
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

const sampleBook: ReaderBook = {
  ...sampleBookMetadata,
  chapters: [{ id: 'sample-chapter', paragraphId: 'p1', title: 'Sample passage' }],
  paragraphs: sampleParagraphs,
  source: 'sample',
};

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

function findKnownSegmentForSelection(selectedText: string, readerParagraphs: Paragraph[]) {
  const normalizedSelection = normalizeSelectionText(selectedText);

  if (!normalizedSelection) {
    return null;
  }

  return (
    readerParagraphs
      .flatMap((paragraph) => paragraph.segments)
      .find((segment) => normalizeSelectionText(segment.text) === normalizedSelection) ?? null
  );
}

function getParagraphById(paragraphId: string, readerParagraphs: Paragraph[]) {
  return readerParagraphs.find((paragraph) => paragraph.id === paragraphId) ?? null;
}

function getApiBaseUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  const devServerHost = getNativeDevServerHost();

  if (devServerHost && !isLoopbackHost(devServerHost)) {
    return `http://${devServerHost}:8000`;
  }

  return 'http://localhost:8000';
}

function getNativeDevServerHost() {
  if (Platform.OS === 'web') {
    return null;
  }

  const sourceCode = NativeModules.SourceCode as { scriptURL?: string } | undefined;
  const scriptUrl = sourceCode?.scriptURL;

  if (!scriptUrl) {
    return null;
  }

  const hostMatch = scriptUrl.match(/^(?:https?|exp):\/\/([^/:]+)/);
  return hostMatch?.[1] ?? null;
}

function isLoopbackHost(host: string) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function createAssistPayload(
  selection: ReaderSelection,
  action: InsightAction,
  readerBook: ReaderBook,
  question?: string,
): AssistRequestPayload {
  const paragraph = getParagraphById(selection.paragraphId, readerBook.paragraphs);

  return {
    action,
    author: readerBook.author,
    bookTitle: readerBook.title,
    paragraphText: paragraph ? getParagraphText(paragraph) : selection.text,
    question,
    selectedText: selection.text,
    selectionKind: selection.selectionKind,
  };
}

function toReaderBook(parsedBook: ParsedEpubBook): ReaderBook {
  return {
    author: parsedBook.author,
    chapters: parsedBook.chapters,
    fileName: parsedBook.fileName,
    page: 'Imported EPUB',
    paragraphs: parsedBook.paragraphs,
    progress: `${parsedBook.paragraphs.length} paragraphs`,
    source: 'epub',
    title: parsedBook.title,
  };
}

async function requestAssist(payload: AssistRequestPayload): Promise<Insight> {
  const assistUrl = `${apiBaseUrl}/ai/assist`;
  let response: Response;

  try {
    response = await fetch(assistUrl, {
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  } catch (error) {
    throw new Error(`Could not reach ${assistUrl}. ${getErrorMessage(error)}`);
  }

  if (!response.ok) {
    const errorDetail = await readResponseError(response);
    throw new Error(errorDetail ?? `AI request failed with status ${response.status}.`);
  }

  const data: unknown = await response.json();

  if (!isRecord(data) || typeof data.eyebrow !== 'string' || typeof data.body !== 'string') {
    throw new Error('AI response was not in the expected format.');
  }

  return {
    body: data.body.trim(),
    eyebrow: data.eyebrow.trim(),
  };
}

async function readResponseError(response: Response) {
  const responseText = await response.text();

  if (!responseText) {
    return null;
  }

  try {
    const parsedBody: unknown = JSON.parse(responseText);

    if (isRecord(parsedBody) && typeof parsedBody.detail === 'string') {
      return parsedBody.detail;
    }
  } catch {
    return responseText;
  }

  return responseText;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'AI request failed.';
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

function createReaderHtml(readerParagraphs: Paragraph[]) {
  const body = readerParagraphs.map(renderReaderBlockHtml).join('\n');

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
        font-size: 17px;
        line-height: 1.55;
        padding: 18px 28px 146px;
        -webkit-touch-callout: none;
        -webkit-user-select: text;
        user-select: text;
      }

      .reader-block {
        color: #171715;
        font-family: Georgia, 'Times New Roman', serif;
        letter-spacing: 0;
        -webkit-touch-callout: none;
        -webkit-user-select: text;
        user-select: text;
      }

      .reader-body {
        font-size: 17px;
        font-weight: 400;
        line-height: 1.55;
        margin: 0 0 22px;
        text-align: left;
        text-indent: 1.15em;
      }

      .reader-body:first-child,
      .reader-chapterTitle + .reader-body,
      .reader-sectionHeading + .reader-body,
      .reader-subheading + .reader-body {
        text-indent: 0;
      }

      .reader-chapterNumber {
        font-size: 30px;
        font-weight: 700;
        line-height: 1.08;
        margin: 46px 0 56px;
        text-align: center;
      }

      .reader-chapterTitle {
        font-size: 29px;
        font-weight: 700;
        line-height: 1.05;
        margin: 0 0 54px;
        text-align: center;
      }

      .reader-sectionHeading {
        font-size: 18px;
        font-weight: 700;
        line-height: 1.25;
        margin: 34px 0 20px;
        text-align: left;
      }

      .reader-subheading {
        font-size: 17px;
        font-weight: 400;
        line-height: 1.35;
        margin: 28px 0 18px;
        text-align: left;
      }

      .reader-quote {
        border-left: 2px solid #d8d1c4;
        color: #3f3b34;
        font-size: 16px;
        font-style: italic;
        line-height: 1.5;
        margin: 22px 0 24px;
        padding-left: 14px;
      }

      .reader-listItem {
        font-size: 17px;
        line-height: 1.5;
        margin: 0 0 14px 18px;
      }

      ::selection {
        background: #cfdec8;
        color: #171715;
      }

      .reader-selection-highlight {
        background: #cfdec8;
        border-radius: 3px;
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

        var timer;
        var isClearingNativeSelection = false;

        function postMessage(message) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }

        function removeAppHighlight() {
          var highlights = Array.prototype.slice.call(document.querySelectorAll('.reader-selection-highlight'));

          highlights.forEach(function (highlight) {
            var parent = highlight.parentNode;

            if (!parent) {
              return;
            }

            parent.replaceChild(document.createTextNode(highlight.textContent || ''), highlight);
            parent.normalize();
          });
        }

        function freezeSelection(range, selection) {
          var frozenRange = range.cloneRange();

          setTimeout(function () {
            removeAppHighlight();

            try {
              var highlight = document.createElement('span');
              highlight.className = 'reader-selection-highlight';
              frozenRange.surroundContents(highlight);
            } catch (error) {
              // If WebKit gives us a complex range, keep the app bar and simply drop native selection.
            }

            isClearingNativeSelection = true;
            selection.removeAllRanges();

            setTimeout(function () {
              isClearingNativeSelection = false;
            }, 0);
          }, 0);
        }

        function postSelection(shouldFreezeSelection) {
          var selection = window.getSelection();

          if (!selection || selection.rangeCount === 0) {
            return;
          }

          var text = normalize(selection.toString());

          if (!text) {
            if (!isClearingNativeSelection) {
              postMessage({ type: 'clearSelection' });
            }
            return;
          }

          var range = selection.getRangeAt(0);
          var paragraph = closestParagraph(range.commonAncestorContainer) || closestParagraph(selection.anchorNode);

          if (!paragraph) {
            return;
          }

          postMessage({
            type: 'selection',
            paragraphId: paragraph.dataset.paragraphId,
            selectionKind: inferSelectionKind(text),
            text: text
          });

          if (shouldFreezeSelection) {
            freezeSelection(range, selection);
          }
        }

        function clearReaderSelection() {
          removeAppHighlight();
          postMessage({ type: 'clearSelection' });
        }

        function schedulePostSelection(shouldFreezeSelection) {
          clearTimeout(timer);
          timer = setTimeout(function () {
            postSelection(shouldFreezeSelection);
          }, shouldFreezeSelection ? 40 : 160);
        }

        document.addEventListener('selectionchange', function () {
          schedulePostSelection(false);
        });
        document.addEventListener('mouseup', function () {
          schedulePostSelection(true);
        });
        document.addEventListener('touchend', function () {
          schedulePostSelection(true);
        });
        document.addEventListener('touchstart', clearReaderSelection);
        document.addEventListener('mousedown', clearReaderSelection);
      })();
    </script>
  </body>
  </html>`;
}

function renderReaderBlockHtml(paragraph: Paragraph) {
  const blockKind = getReaderBlockKind(paragraph);
  const tagName = getReaderHtmlTag(blockKind);
  const className = `reader-block reader-${blockKind}`;
  const text = escapeHtml(getParagraphText(paragraph));

  return `<${tagName} id="${escapeHtml(paragraph.id)}" data-paragraph-id="${escapeHtml(
    paragraph.id,
  )}" data-reader-block="${blockKind}" class="${className}">${text}</${tagName}>`;
}

function getReaderBlockKind(paragraph: Paragraph): ReaderBlockKind {
  return paragraph.blockKind ?? 'body';
}

function getReaderHtmlTag(blockKind: ReaderBlockKind) {
  switch (blockKind) {
    case 'chapterNumber':
    case 'chapterTitle':
      return 'h1';
    case 'sectionHeading':
      return 'h2';
    case 'subheading':
      return 'h3';
    case 'quote':
      return 'blockquote';
    default:
      return 'p';
  }
}

export default function App() {
  const [currentBook, setCurrentBook] = useState<ReaderBook>(sampleBook);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [selectedAction, setSelectedAction] = useState<InsightAction | null>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [savedInsightIds, setSavedInsightIds] = useState<string[]>([]);
  const [isImportingBook, setIsImportingBook] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [isAssistLoading, setIsAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [copiedSelectionId, setCopiedSelectionId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const assistRequestId = useRef(0);
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerHtml = useMemo(() => createReaderHtml(currentBook.paragraphs), [currentBook.paragraphs]);

  const insightId = selection && selectedAction && insight ? `${selection.id}:${selectedAction}:${insight.body}` : null;
  const isSaved = insightId ? savedInsightIds.includes(insightId) : false;

  function clearSelection() {
    assistRequestId.current += 1;
    setSelection(null);
    setSelectedAction(null);
    setInsight(null);
    setAssistError(null);
    setIsAssistLoading(false);
    setCopiedSelectionId(null);
    setIsAskOpen(false);
    setQuestion('');
  }

  function jumpToChapter(chapter: ReaderChapter) {
    clearSelection();
    setScrollTarget({
      nonce: Date.now(),
      paragraphId: chapter.paragraphId,
    });
    setIsTocOpen(false);
  }

  function setSelectionFromReader(text: string, paragraphId: string, selectionKind: SelectionKind) {
    const normalizedText = normalizeSelectionText(text);
    const knownSegment = findKnownSegmentForSelection(normalizedText, currentBook.paragraphs);

    if (!normalizedText) {
      clearSelection();
      return;
    }

    assistRequestId.current += 1;
    setSelection({
      id: knownSegment?.id ?? `selection:${paragraphId}:${normalizedText}`,
      paragraphId: knownSegment?.paragraphId ?? paragraphId,
      selectionKind: knownSegment?.selectionKind ?? selectionKind,
      text: normalizedText,
    });
    setSelectedAction(null);
    setInsight(null);
    setAssistError(null);
    setIsAssistLoading(false);
    setCopiedSelectionId(null);
    setIsAskOpen(false);
  }

  function handleReaderMessage(message: ReaderMessage) {
    if (message.type === 'clearSelection') {
      clearSelection();
      return;
    }

    setSelectionFromReader(message.text, message.paragraphId, message.selectionKind);
  }

  useEffect(() => {
    return () => {
      if (copyFeedbackTimer.current) {
        clearTimeout(copyFeedbackTimer.current);
      }
    };
  }, []);

  function chooseAction(action: SelectionAction) {
    if (action === 'copy') {
      void copySelectionToClipboard();
      return;
    }

    if (action === 'ask') {
      assistRequestId.current += 1;
      setIsAskOpen(true);
      setSelectedAction('ask');
      setInsight(null);
      setAssistError(null);
      setIsAssistLoading(false);
      return;
    }

    setIsAskOpen(false);
    void runAssist(action);
  }

  async function copySelectionToClipboard() {
    if (!selection) {
      return;
    }

    const copiedId = selection.id;
    await Clipboard.setStringAsync(selection.text);
    setCopiedSelectionId(copiedId);

    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current);
    }

    copyFeedbackTimer.current = setTimeout(() => {
      setCopiedSelectionId((currentId) => (currentId === copiedId ? null : currentId));
    }, 1400);
  }

  async function importEpubBook() {
    setImportError(null);
    setIsImportingBook(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/epub+zip', 'application/octet-stream', '*/*'],
      });

      if (result.canceled) {
        return;
      }

      const importedBook = toReaderBook(await parseEpubAsset(result.assets[0]));
      clearSelection();
      setSavedInsightIds([]);
      setCurrentBook(importedBook);
    } catch (error) {
      setImportError(getErrorMessage(error));
    } finally {
      setIsImportingBook(false);
    }
  }

  async function runAssist(action: InsightAction, questionText?: string) {
    if (!selection) {
      return;
    }

    const requestId = assistRequestId.current + 1;
    assistRequestId.current = requestId;

    setSelectedAction(action);
    setInsight(null);
    setAssistError(null);
    setIsAssistLoading(true);

    try {
      const nextInsight = await requestAssist(createAssistPayload(selection, action, currentBook, questionText));

      if (assistRequestId.current === requestId) {
        setInsight(nextInsight);
      }
    } catch (error) {
      if (assistRequestId.current === requestId) {
        setAssistError(getErrorMessage(error));
      }
    } finally {
      if (assistRequestId.current === requestId) {
        setIsAssistLoading(false);
      }
    }
  }

  function saveInsight() {
    if (!insightId || isSaved) {
      return;
    }

    setSavedInsightIds((currentIds) => [...currentIds, insightId]);
  }

  function submitQuestion() {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      return;
    }

    setIsAskOpen(false);
    setQuestion('');
    void runAssist('ask', trimmedQuestion);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={[styles.phoneShell, Platform.OS !== 'web' && styles.nativeShell]}>
        <View style={styles.readerScreen}>
          <ReaderHeader book={currentBook} isImportingBook={isImportingBook} onImportBook={importEpubBook} />

          {importError ? <ImportErrorBanner message={importError} onDismiss={() => setImportError(null)} /> : null}

          <ReaderSurface
            html={readerHtml}
            onClearSelection={clearSelection}
            onSelectionMessage={handleReaderMessage}
            paragraphs={currentBook.paragraphs}
            scrollTarget={scrollTarget}
          />

          {selection ? (
            <SelectionPanel
              activeAction={selectedAction}
              errorMessage={assistError}
              insight={insight}
              isCopied={copiedSelectionId === selection.id}
              isLoading={isAssistLoading}
              isSaved={isSaved}
              onAskMore={() => setIsAskOpen(true)}
              onChooseAction={chooseAction}
              onMakeSimpler={() => void runAssist('simpler')}
              onSave={saveInsight}
              selectionKind={selection.selectionKind}
            />
          ) : null}

          <ReaderFooter
            book={currentBook}
            onOpenTableOfContents={() => setIsTocOpen(true)}
            savedCount={savedInsightIds.length}
          />

          {isAskOpen && selection ? (
            <AskSheet
              question={question}
              selectedText={selection.text}
              onChangeQuestion={setQuestion}
              onClose={() => setIsAskOpen(false)}
              onSubmit={submitQuestion}
            />
          ) : null}

          {isTocOpen ? (
            <TableOfContentsSheet
              chapters={currentBook.chapters}
              onClose={() => setIsTocOpen(false)}
              onSelectChapter={jumpToChapter}
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
  paragraphs,
  scrollTarget,
}: {
  html: string;
  onClearSelection: () => void;
  onSelectionMessage: (message: ReaderMessage) => void;
  paragraphs: Paragraph[];
  scrollTarget: ScrollTarget | null;
}) {
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !scrollTarget) {
      return;
    }

    webViewRef.current?.injectJavaScript(`
      (function () {
        var target = document.getElementById(${JSON.stringify(scrollTarget.paragraphId)});
        if (target) {
          target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      })();
      true;
    `);
  }, [scrollTarget]);

  if (Platform.OS === 'web') {
    return (
      <WebFallbackReader
        onClearSelection={onClearSelection}
        onSelectionMessage={onSelectionMessage}
        paragraphs={paragraphs}
        scrollTarget={scrollTarget}
      />
    );
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
      ref={webViewRef}
      automaticallyAdjustContentInsets={false}
      bounces
      javaScriptEnabled
      onMessage={handleMessage}
      originWhitelist={['*']}
      scrollEnabled
      source={{ html }}
      suppressMenuItems={[
        'copy',
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
  paragraphs,
  scrollTarget,
}: {
  onClearSelection: () => void;
  onSelectionMessage: (message: ReaderMessage) => void;
  paragraphs: Paragraph[];
  scrollTarget: ScrollTarget | null;
}) {
  useEffect(() => {
    if (!scrollTarget || typeof document === 'undefined') {
      return;
    }

    document.getElementById(scrollTarget.paragraphId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollTarget]);

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
  }, [onSelectionMessage, paragraphs]);

  return (
    <Pressable accessible={false} onPress={onClearSelection} style={styles.readingLayer}>
      <ScrollView
        contentContainerStyle={styles.readingContent}
        scrollIndicatorInsets={{ bottom: 88 }}
        showsVerticalScrollIndicator={false}
      >
        {paragraphs.map((paragraph) => (
          <View key={paragraph.id} nativeID={paragraph.id} style={getReaderBlockStyle(paragraph)}>
            <Text selectable style={getReaderTextStyle(paragraph)}>
              {getParagraphText(paragraph)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Pressable>
  );
}

function getReaderBlockStyle(paragraph: Paragraph) {
  const blockKind = getReaderBlockKind(paragraph);

  switch (blockKind) {
    case 'chapterNumber':
      return [styles.paragraphBlock, styles.paragraphBlockChapterNumber];
    case 'chapterTitle':
      return [styles.paragraphBlock, styles.paragraphBlockChapterTitle];
    case 'sectionHeading':
      return [styles.paragraphBlock, styles.paragraphBlockSectionHeading];
    case 'subheading':
      return [styles.paragraphBlock, styles.paragraphBlockSubheading];
    case 'quote':
      return [styles.paragraphBlock, styles.paragraphBlockQuote];
    case 'listItem':
      return [styles.paragraphBlock, styles.paragraphBlockListItem];
    default:
      return styles.paragraphBlock;
  }
}

function getReaderTextStyle(paragraph: Paragraph) {
  const blockKind = getReaderBlockKind(paragraph);

  switch (blockKind) {
    case 'chapterNumber':
      return [styles.paragraph, styles.paragraphChapterNumber];
    case 'chapterTitle':
      return [styles.paragraph, styles.paragraphChapterTitle];
    case 'sectionHeading':
      return [styles.paragraph, styles.paragraphSectionHeading];
    case 'subheading':
      return [styles.paragraph, styles.paragraphSubheading];
    case 'quote':
      return [styles.paragraph, styles.paragraphQuote];
    case 'listItem':
      return [styles.paragraph, styles.paragraphListItem];
    default:
      return styles.paragraph;
  }
}

function ReaderHeader({
  book,
  isImportingBook,
  onImportBook,
}: {
  book: ReaderBook;
  isImportingBook: boolean;
  onImportBook: () => void;
}) {
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
        <Pressable
          accessibilityLabel="Import EPUB"
          accessibilityRole="button"
          disabled={isImportingBook}
          onPress={onImportBook}
          style={[styles.headerIconButton, isImportingBook && styles.disabledButton]}
        >
          {isImportingBook ? (
            <ActivityIndicator color={colors.sageDark} size="small" />
          ) : (
            <Upload color={colors.ink} size={19} strokeWidth={2} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function ImportErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.importErrorBanner}>
      <Text numberOfLines={2} style={styles.importErrorText}>
        {message}
      </Text>
    </Pressable>
  );
}

function ReaderFooter({
  book,
  onOpenTableOfContents,
  savedCount,
}: {
  book: ReaderBook;
  onOpenTableOfContents: () => void;
  savedCount: number;
}) {
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
        <Pressable
          accessibilityLabel="Table of contents"
          accessibilityRole="button"
          onPress={onOpenTableOfContents}
          style={styles.bottomIcon}
        >
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

function TableOfContentsSheet({
  chapters,
  onClose,
  onSelectChapter,
}: {
  chapters: ReaderChapter[];
  onClose: () => void;
  onSelectChapter: (chapter: ReaderChapter) => void;
}) {
  return (
    <View style={styles.sheetLayer}>
      <Pressable accessibilityRole="button" style={styles.sheetScrim} onPress={onClose} />
      <View style={styles.tocSheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.tocTitle}>Contents</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={styles.tocList}>
          {chapters.map((chapter, index) => (
            <Pressable
              key={chapter.id}
              accessibilityRole="button"
              onPress={() => onSelectChapter(chapter)}
              style={({ pressed }) => [styles.tocItem, pressed && styles.pressed]}
            >
              <Text style={styles.tocIndex}>{index + 1}</Text>
              <Text numberOfLines={2} style={styles.tocItemText}>
                {chapter.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function SelectionPanel({
  activeAction,
  errorMessage,
  insight,
  isCopied,
  isLoading,
  isSaved,
  onAskMore,
  onChooseAction,
  onMakeSimpler,
  onSave,
  selectionKind,
}: {
  activeAction: InsightAction | null;
  errorMessage: string | null;
  insight: Insight | null;
  isCopied: boolean;
  isLoading: boolean;
  isSaved: boolean;
  onAskMore: () => void;
  onChooseAction: (action: SelectionAction) => void;
  onMakeSimpler: () => void;
  onSave: () => void;
  selectionKind: SelectionKind;
}) {
  return (
    <Pressable accessible={false} onPress={stopPressPropagation} style={styles.selectionPanel}>
      <QuickActionMenu
        activeAction={activeAction}
        isCopied={isCopied}
        onChooseAction={onChooseAction}
        selectionKind={selectionKind}
      />

      {isLoading ? <LoadingInsightCard /> : null}

      {errorMessage && !isLoading ? <ErrorInsightCard message={errorMessage} /> : null}

      {insight && !isLoading ? (
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
  isCopied,
  onChooseAction,
  selectionKind,
}: {
  activeAction: InsightAction | null;
  isCopied: boolean;
  onChooseAction: (action: SelectionAction) => void;
  selectionKind: SelectionKind;
}) {
  return (
    <View style={styles.actionMenu}>
      {selectionActions.map(({ action, icon: Icon, label }) => {
        const isCopiedAction = action === 'copy' && isCopied;
        const isActive = !isCopied && activeAction === action;
        const visibleLabel =
          action === 'explain' && selectionKind === 'word' ? 'Define' : isCopiedAction ? 'Copied' : label;
        const buttonColor = isActive || isCopiedAction ? colors.sageDark : colors.ink;

        return (
          <Pressable
            key={action}
            accessibilityLabel={visibleLabel}
            accessibilityRole="button"
            onPress={() => onChooseAction(action)}
            style={({ pressed }) => [
              styles.actionButton,
              (isActive || isCopiedAction) && styles.actionButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Icon color={buttonColor} size={20} strokeWidth={1.8} />
            <Text style={[styles.actionText, (isActive || isCopiedAction) && styles.actionTextActive]}>
              {visibleLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LoadingInsightCard() {
  return (
    <View style={styles.insightCard}>
      <View style={styles.insightHeader}>
        <ActivityIndicator color={colors.clay} size="small" />
        <Text style={styles.insightEyebrow}>Thinking</Text>
      </View>
      <Text style={styles.insightBody}>Reading the selected passage...</Text>
    </View>
  );
}

function ErrorInsightCard({ message }: { message: string }) {
  return (
    <View style={[styles.insightCard, styles.errorCard]}>
      <View style={styles.insightHeader}>
        <HelpCircle color={colors.error} size={17} strokeWidth={2} />
        <Text style={[styles.insightEyebrow, styles.errorText]}>AI unavailable</Text>
      </View>
      <Text style={[styles.insightBody, styles.errorText]}>{message}</Text>
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
  error: '#9c2f2f',
  errorBackground: '#fff1f1',
  errorBorder: '#e7b6b6',
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
  disabledButton: {
    opacity: 0.55,
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
    paddingHorizontal: 28,
    paddingTop: 18,
  },
  paragraphBlock: {
    marginBottom: 22,
  },
  paragraphBlockChapterNumber: {
    marginBottom: 52,
    marginTop: 46,
  },
  paragraphBlockChapterTitle: {
    marginBottom: 52,
  },
  paragraphBlockSectionHeading: {
    marginBottom: 18,
    marginTop: 32,
  },
  paragraphBlockSubheading: {
    marginBottom: 16,
    marginTop: 26,
  },
  paragraphBlockQuote: {
    borderLeftColor: '#d8d1c4',
    borderLeftWidth: 2,
    marginBottom: 24,
    marginTop: 22,
    paddingLeft: 14,
  },
  paragraphBlockListItem: {
    marginBottom: 14,
    marginLeft: 18,
  },
  paragraph: {
    color: colors.ink,
    fontFamily: readerFont,
    fontSize: 17,
    letterSpacing: 0,
    lineHeight: 26,
  },
  paragraphChapterNumber: {
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 33,
    textAlign: 'center',
  },
  paragraphChapterTitle: {
    fontSize: 29,
    fontWeight: '700',
    lineHeight: 31,
    textAlign: 'center',
  },
  paragraphSectionHeading: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
  },
  paragraphSubheading: {
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 23,
  },
  paragraphQuote: {
    color: '#3f3b34',
    fontSize: 16,
    fontStyle: 'italic',
    lineHeight: 24,
  },
  paragraphListItem: {
    fontSize: 17,
    lineHeight: 25,
  },
  importErrorBanner: {
    backgroundColor: colors.errorBackground,
    borderBottomColor: colors.errorBorder,
    borderBottomWidth: 1,
    paddingHorizontal: 27,
    paddingVertical: 9,
  },
  importErrorText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 16,
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
  errorCard: {
    backgroundColor: colors.errorBackground,
    borderColor: colors.errorBorder,
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
  errorText: {
    color: colors.error,
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
  tocSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '62%',
    paddingBottom: 18,
    paddingHorizontal: 16,
    paddingTop: 9,
    shadowColor: colors.shadow,
    shadowOffset: { height: -8, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  tocTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 8,
  },
  tocList: {
    maxHeight: 360,
  },
  tocItem: {
    alignItems: 'center',
    borderBottomColor: colors.hairline,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
    paddingVertical: 9,
  },
  tocIndex: {
    color: colors.mutedInk,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textAlign: 'right',
    width: 24,
  },
  tocItemText: {
    color: colors.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 18,
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
