import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import type { DocumentPickerAsset } from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { requireOptionalNativeModule } from 'expo';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Camera,
  Check,
  Copy as CopyIcon,
  FileText,
  HelpCircle,
  Highlighter,
  Library as LibraryIcon,
  List,
  LogIn,
  LogOut,
  LucideProps,
  MessageCircle,
  Pencil,
  Search,
  Send,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  Upload,
  User,
  X,
} from 'lucide-react-native';
import { ComponentType, useEffect, useMemo, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { AnswerMarkdown } from './src/components/AnswerMarkdown';
import { flattenAnswerMarkdown } from './src/components/parseAnswerMarkdown';
import { BookSources } from './src/components/BookSources';
import { ConversationThread } from './src/components/ConversationThread';
import { MindMapScreen } from './src/components/MindMapScreen';
import { SessionExpiredBanner } from './src/components/SessionExpiredBanner';
import { BackgroundJobBanner } from './src/components/BackgroundJobBanner';
import { SignInSheet } from './src/components/SignInSheet';
import { WholeBookAiSheet } from './src/components/WholeBookAiSheet';
import { generateMindMap, getMindMap } from './src/rag/mindmapApi';
import { resolveMindMapBookId, shouldStartMindMapGeneration } from './src/rag/mindmapTarget';
import type { MindMapData, MindMapStatus } from './src/rag/mindmapTypes';
import type { BookSource } from './src/rag/bookAskTypes';
import { requestBookAsk } from './src/rag/bookAskApi';
import { buildHistory } from './src/rag/buildHistory';
import { createIndexApi } from './src/rag/indexApi';
import { indexBook } from './src/rag/indexBook';
import type { WholeBookAiState } from './src/rag/types';
import { selectPendingNotice, type PersistedPendingNotice } from './src/rag/backgroundNotice';
import { type ConversationTurn, LIBRARY_SCHEMA_VERSION, migrateLibraryItem } from './src/library/conversation';
import { appendTurns } from './src/library/appendTurn';
import { composeNoteQuestion } from './src/library/composeNoteQuestion';
import {
  formatNoteAsMarkdown,
  formatNoteAsText,
  type ExportableNote,
} from './src/library/savedNoteExport';
import {
  buildAnkiFile,
  buildCardsFromResults,
  classifyNoteForAnkiExport,
  toAnkiNoteInput,
  type AnkiCardResult,
  type AnkiSourceNote,
} from './src/library/ankiExport';
import { requestAnkiCards } from './src/library/ankiApi';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { parseEpubAsset, ParsedEpubBook } from './epub';

type QuickAction = 'explain' | 'example' | 'rephrase' | 'ask';
type ClipboardAction = 'copy';
type HighlightAction = 'highlight';
type SelectionAction = QuickAction | ClipboardAction | HighlightAction;
type FollowUpAction = 'simpler';
type SummaryAction = 'summarize';
type InsightAction = QuickAction | FollowUpAction | SummaryAction | HighlightAction;
type AssistContextScope = 'paragraph' | 'visiblePage' | 'chapter';
type AskContextScope = 'selection' | 'visiblePage' | 'chapter' | 'book';
type LastAskRequest = {
  contextScope: AssistContextScope;
  question: string;
};
type AppIcon = ComponentType<LucideProps>;
type SelectionKind = 'word' | 'phrase' | 'paragraph';
type DocumentSource = 'epub' | 'pdf' | 'sample' | 'scan';
type DocumentBoxUnit = 'px' | 'ratio';
type ReaderBlockKind =
  | 'body'
  | 'chapterNumber'
  | 'chapterTitle'
  | 'sectionHeading'
  | 'subheading'
  | 'quote'
  | 'listItem';

type DocumentBoundingBox = {
  height: number;
  unit: DocumentBoxUnit;
  width: number;
  x: number;
  y: number;
};

type DocumentSourceRef = {
  anchor?: string;
  blockId?: string;
  blockIndex?: number;
  boundingBox?: DocumentBoundingBox;
  fileName?: string;
  href?: string;
  imageUri?: string;
  ocrConfidence?: number;
  pageIndex?: number;
  pageLabel?: string;
  source: DocumentSource;
};

type ReaderSourceDetail = {
  blockCount?: number;
  fileName?: string;
  pageCount?: number;
  source: DocumentSource;
};

type PassageSegment = {
  id: string;
  paragraphId: string;
  selectionKind?: SelectionKind;
  sourceRef?: DocumentSourceRef;
  text: string;
};

type Paragraph = {
  blockKind?: ReaderBlockKind;
  id: string;
  segments: PassageSegment[];
  sourceRef?: DocumentSourceRef;
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
  source: DocumentSource;
  sourceDetail?: ReaderSourceDetail;
  title: string;
};

type ScrollTarget = {
  nonce: number;
  paragraphId: string;
  excerpt?: string;
};

type ReaderSelection = {
  contextScope?: AssistContextScope;
  id: string;
  paragraphId: string;
  selectionKind: SelectionKind;
  text: string;
  visibleParagraphIds?: string[];
};

type Insight = {
  eyebrow: string;
  body: string;
};

type ReaderProgress = {
  page: string;
  percent: number;
  progress: string;
};

type SearchResult = {
  excerpt: string;
  id: string;
  index?: number;
  kind: 'book' | 'note';
  noteId?: string;
  paragraphId: string;
  sourceLabel?: string;
  title: string;
};

type SearchScope = 'book' | 'notes' | 'all';

type ReadingLocation = {
  paragraphId: string;
  sourceRef?: DocumentSourceRef;
};

// BookSource minus its `id`, which is a per-request identifier (s0-0) that means
// nothing once the request is over and would collide across saved notes.
type SavedCitation = Omit<BookSource, 'id'>;

type SavedInsight = {
  action: InsightAction;
  body: string;
  bookTitle: string;
  // Every source the answer drew on, not one promoted to look like a passage the
  // reader chose. Capped at 3, matching the backend.
  citations?: SavedCitation[];
  createdAt: string;
  // The AI's own short label. Not the question — see `question`.
  eyebrow: string;
  id: string;
  paragraphId: string;
  // The self-contained question this note answers. Set for thread-saved notes.
  question?: string;
  // Only ever text the reader actually selected. Never a citation excerpt.
  selectedText: string;
  selectionKind: SelectionKind;
  sourceRef?: DocumentSourceRef;
  updatedAt?: string;
  userNote?: string;
};

type SavedNoteFilter = 'all' | InsightAction;

type LibraryItem = {
  archivedConversations?: ConversationTurn[][];
  book: ReaderBook;
  conversation: ConversationTurn[];
  id: string;
  importedAt: string;
  lastOpenedAt: string;
  mindMapJob?: { status: 'generating' | 'ready' | 'failed' };
  pendingNotice?: PersistedPendingNotice;
  readingLocation: ReadingLocation | null;
  savedInsights: SavedInsight[];
  wholeBookAi: WholeBookAiState;
};

type PersistedReaderState = {
  activeBookId: string;
  libraryItems: LibraryItem[];
  schemaVersion: 4;
};

type AssistRequestPayload = {
  action: InsightAction;
  author: string;
  bookTitle: string;
  contextBlocks: AssistContextBlockPayload[];
  contextScope: AssistContextScope;
  paragraphText?: string;
  question?: string;
  selectedText?: string;
  selectionKind?: SelectionKind;
};

type AssistContextBlockPayload = {
  blockKind?: ReaderBlockKind;
  id: string;
  paragraphId: string;
  sourceRef?: DocumentSourceRef;
  text: string;
};

type OcrRequestPayload = {
  imageDataUrl: string;
};

type ScanStage = 'capturing' | 'idle' | 'preparing' | 'reading' | 'uploading';

type PreparedOcrImage = {
  dataUrl: string;
  height: number;
  payloadBytes: number;
  width: number;
};

type OcrTextBlockResponse = {
  boundingBox?: DocumentBoundingBox;
  confidence?: number | null;
  text: string;
};

type OcrExtractResponse = {
  author: string;
  blocks: OcrTextBlockResponse[];
  language?: string | null;
  text: string;
  title: string;
};

type PdfImportBlockResponse = {
  blockKind: ReaderBlockKind;
  boundingBox?: DocumentBoundingBox;
  confidence?: number;
  text: string;
};

type PdfImportPageResponse = {
  blocks: PdfImportBlockResponse[];
  pageIndex: number;
  pageLabel: string;
  usedOcr: boolean;
};

type PdfImportResult = {
  author: string;
  outline: Array<{ pageIndex: number; title: string; depth?: number }>;
  pageCount: number;
  pages: PdfImportPageResponse[];
  title: string;
};

type AppleVisionOcrModule = {
  recognizeText: (imageUri: string) => Promise<unknown>;
};

type ApplePdfImportModule = {
  extractDocument: (documentUri: string) => Promise<unknown>;
};

type ReaderMessage =
  | {
      type: 'selectionPending';
    }
  | {
      paragraphId: string;
      selectionKind: SelectionKind;
      text: string;
      type: 'selection';
    }
  | {
      paragraphId: string;
      type: 'location';
      visibleParagraphIds?: string[];
    }
  | {
      type: 'clearSelection';
    };

const selectionActions: Array<{ action: SelectionAction; icon: AppIcon; label: string }> = [
  { action: 'explain', icon: Sparkles, label: 'Explain' },
  { action: 'example', icon: BookOpen, label: 'Example' },
  { action: 'rephrase', icon: MessageCircle, label: 'Rephrase' },
  { action: 'ask', icon: HelpCircle, label: 'Ask' },
  { action: 'highlight', icon: Highlighter, label: 'Mark' },
  { action: 'copy', icon: CopyIcon, label: 'Copy' },
];

const sampleBookMetadata = {
  author: 'Daniel Kahneman',
  page: 'Page 112 of 499',
  progress: '22%',
  title: 'Thinking, Fast and Slow',
};

const apiBaseUrl = getApiBaseUrl();
const appleVisionOcr = requireOptionalNativeModule<AppleVisionOcrModule>('AppleVisionOCR');
const applePdfImport = requireOptionalNativeModule<ApplePdfImportModule>('ApplePDFImport');
const readerStateFileName = 'reader-state.json';
const readerStatePath = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}${readerStateFileName}`
  : null;
const assistContextMaxChars = 18_000;
const assistContextBlockMaxChars = 3_500;
const visibleContextFallbackRadius = 2;
const summarySelectionText = 'Visible page summary';
const ocrImageMaxDimension = 2200;
const ocrImageCompression = 0.7;
const ocrRequestTimeoutMs = 75_000;

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
  paragraphs: withParagraphSourceRefs(sampleParagraphs, 'sample'),
  source: 'sample',
  sourceDetail: {
    blockCount: sampleParagraphs.length,
    source: 'sample',
  },
};

const defaultWholeBookAiState: WholeBookAiState = {
  acknowledgedBatch: -1,
  progress: 0,
  status: 'not_enabled',
};

const sampleLibraryItem: LibraryItem = {
  book: sampleBook,
  conversation: [],
  id: 'sample:thinking-fast-and-slow',
  importedAt: 'sample',
  lastOpenedAt: 'sample',
  readingLocation: null,
  savedInsights: [],
  wholeBookAi: defaultWholeBookAiState,
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

function getParagraphIndex(paragraphId: string, readerParagraphs: Paragraph[]) {
  return readerParagraphs.findIndex((paragraph) => paragraph.id === paragraphId);
}

function withParagraphSourceRefs(
  paragraphs: Paragraph[],
  source: DocumentSource,
  fileName?: string,
): Paragraph[] {
  return paragraphs.map((paragraph, blockIndex) => {
    const sourceRef = normalizeSourceRef(paragraph.sourceRef, {
      blockId: paragraph.id,
      blockIndex,
      fileName,
      source,
    });

    return {
      ...paragraph,
      sourceRef,
      segments: paragraph.segments.map((segment) => ({
        ...segment,
        sourceRef: normalizeSourceRef(segment.sourceRef, sourceRef),
      })),
    };
  });
}

function hydrateReaderBook(book: ReaderBook): ReaderBook {
  const paragraphs = withParagraphSourceRefs(book.paragraphs, book.source, book.fileName);

  return {
    ...book,
    paragraphs,
    sourceDetail: normalizeReaderSourceDetail(book.sourceDetail, book.source, paragraphs.length, book.fileName),
  };
}

function hydrateLibraryItem(item: LibraryItem): LibraryItem {
  const book = hydrateReaderBook(item.book);

  return {
    ...item,
    book,
    readingLocation: hydrateReadingLocation(item.readingLocation, book),
    savedInsights: hydrateSavedInsightSourceRefs(item.savedInsights, book),
    wholeBookAi: item.wholeBookAi ?? defaultWholeBookAiState,
  };
}

function hydrateReadingLocation(
  readingLocation: ReadingLocation | null,
  readerBook: ReaderBook,
): ReadingLocation | null {
  if (!readingLocation || !getParagraphById(readingLocation.paragraphId, readerBook.paragraphs)) {
    return getInitialReadingLocation(readerBook);
  }

  return {
    ...readingLocation,
    sourceRef: normalizeSourceRef(
      readingLocation.sourceRef,
      getParagraphSourceRef(readingLocation.paragraphId, readerBook),
    ),
  };
}

function hydrateSavedInsightSourceRefs(savedInsights: SavedInsight[], readerBook: ReaderBook): SavedInsight[] {
  return savedInsights.map((note) => ({
    ...note,
    sourceRef: normalizeSourceRef(note.sourceRef, getSavedInsightFallbackSourceRef(note, readerBook)),
  }));
}

function getSavedInsightFallbackSourceRef(note: SavedInsight, readerBook: ReaderBook): DocumentSourceRef {
  return (
    getParagraphSourceRef(note.paragraphId, readerBook) ?? {
      fileName: readerBook.fileName,
      source: readerBook.source,
    }
  );
}

function getParagraphSourceRef(paragraphId: string, readerBook: ReaderBook): DocumentSourceRef | undefined {
  const paragraphIndex = getParagraphIndex(paragraphId, readerBook.paragraphs);
  const paragraph = paragraphIndex >= 0 ? readerBook.paragraphs[paragraphIndex] : null;

  if (!paragraph) {
    return undefined;
  }

  return normalizeSourceRef(paragraph.sourceRef, {
    blockId: paragraph.id,
    blockIndex: paragraphIndex,
    fileName: readerBook.fileName,
    source: readerBook.source,
  });
}

function normalizeSourceRef(
  sourceRef: DocumentSourceRef | undefined,
  fallback: DocumentSourceRef | undefined,
): DocumentSourceRef {
  return {
    anchor: sourceRef?.anchor ?? fallback?.anchor,
    blockId: sourceRef?.blockId ?? fallback?.blockId,
    blockIndex: sourceRef?.blockIndex ?? fallback?.blockIndex,
    boundingBox: sourceRef?.boundingBox ?? fallback?.boundingBox,
    fileName: sourceRef?.fileName ?? fallback?.fileName,
    href: sourceRef?.href ?? fallback?.href,
    imageUri: sourceRef?.imageUri ?? fallback?.imageUri,
    ocrConfidence: sourceRef?.ocrConfidence ?? fallback?.ocrConfidence,
    pageIndex: sourceRef?.pageIndex ?? fallback?.pageIndex,
    pageLabel: sourceRef?.pageLabel ?? fallback?.pageLabel,
    source: sourceRef?.source ?? fallback?.source ?? 'sample',
  };
}

function normalizeReaderSourceDetail(
  sourceDetail: ReaderSourceDetail | undefined,
  source: DocumentSource,
  blockCount: number,
  fileName?: string,
): ReaderSourceDetail {
  return {
    blockCount: sourceDetail?.blockCount ?? blockCount,
    fileName: sourceDetail?.fileName ?? fileName,
    pageCount: sourceDetail?.pageCount,
    source: sourceDetail?.source ?? source,
  };
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
  contextScope: AssistContextScope = 'paragraph',
): AssistRequestPayload {
  const contextBlocks = getAssistContextBlocks(readerBook, selection, contextScope);
  const paragraphText = getLegacyParagraphText(contextBlocks) || selection.text;

  return {
    action,
    author: readerBook.author,
    bookTitle: readerBook.title,
    contextBlocks,
    contextScope,
    paragraphText,
    question,
    selectedText: selection.text,
    selectionKind: selection.selectionKind,
  };
}

function getAssistContextBlocks(
  readerBook: ReaderBook,
  selection: ReaderSelection,
  contextScope: AssistContextScope,
): AssistContextBlockPayload[] {
  return capAssistContextBlocks(
    getAssistContextParagraphs(readerBook, selection, contextScope).map((paragraph) => ({
      blockKind: getReaderBlockKind(paragraph),
      id: paragraph.id,
      paragraphId: paragraph.id,
      sourceRef: getParagraphSourceRef(paragraph.id, readerBook),
      text: normalizeSelectionText(getParagraphText(paragraph)),
    })),
  );
}

function getAssistContextParagraphs(
  readerBook: ReaderBook,
  selection: ReaderSelection,
  contextScope: AssistContextScope,
): Paragraph[] {
  switch (contextScope) {
    case 'chapter':
      return getChapterContextParagraphs(readerBook, selection.paragraphId);
    case 'visiblePage':
      return getVisiblePageContextParagraphs(readerBook, selection.paragraphId, selection.visibleParagraphIds ?? []);
    default: {
      const paragraph = getParagraphById(selection.paragraphId, readerBook.paragraphs);
      return paragraph ? [paragraph] : [];
    }
  }
}

function getVisiblePageContextParagraphs(
  readerBook: ReaderBook,
  anchorParagraphId: string,
  visibleParagraphIds: string[],
): Paragraph[] {
  const anchorParagraph = getParagraphById(anchorParagraphId, readerBook.paragraphs);
  const anchorPageIndex = anchorParagraph?.sourceRef?.pageIndex;

  if (
    (readerBook.source === 'pdf' || readerBook.source === 'scan') &&
    typeof anchorPageIndex === 'number'
  ) {
    const pageParagraphs = readerBook.paragraphs.filter(
      (paragraph) => paragraph.sourceRef?.pageIndex === anchorPageIndex,
    );

    if (pageParagraphs.length > 0) {
      return pageParagraphs;
    }
  }

  const visibleParagraphs = getParagraphsByIds(
    readerBook.paragraphs,
    normalizeVisibleParagraphIds(visibleParagraphIds, readerBook.paragraphs, anchorParagraphId),
  );

  if (visibleParagraphs.length > 0) {
    return visibleParagraphs;
  }

  return getNearbyParagraphs(readerBook.paragraphs, anchorParagraphId, visibleContextFallbackRadius);
}

function getChapterContextParagraphs(readerBook: ReaderBook, anchorParagraphId: string): Paragraph[] {
  const anchorIndex = getParagraphIndex(anchorParagraphId, readerBook.paragraphs);

  if (anchorIndex < 0) {
    return [];
  }

  const chapterStarts = readerBook.chapters
    .map((chapter) => ({
      index: getParagraphIndex(chapter.paragraphId, readerBook.paragraphs),
      paragraphId: chapter.paragraphId,
    }))
    .filter((chapter) => chapter.index >= 0)
    .sort((firstChapter, secondChapter) => firstChapter.index - secondChapter.index);
  const previousChapterStarts = chapterStarts.filter((chapter) => chapter.index <= anchorIndex);
  const currentChapter = previousChapterStarts[previousChapterStarts.length - 1];
  const nextChapter = chapterStarts.find((chapter) => chapter.index > (currentChapter?.index ?? anchorIndex));
  const startIndex = currentChapter?.index ?? anchorIndex;
  const endIndex = nextChapter?.index ?? readerBook.paragraphs.length;

  return readerBook.paragraphs.slice(startIndex, endIndex);
}

function getNearbyParagraphs(readerParagraphs: Paragraph[], anchorParagraphId: string, radius: number) {
  const anchorIndex = getParagraphIndex(anchorParagraphId, readerParagraphs);

  if (anchorIndex < 0) {
    return readerParagraphs.slice(0, Math.max(1, radius * 2 + 1));
  }

  return readerParagraphs.slice(
    Math.max(0, anchorIndex - radius),
    Math.min(readerParagraphs.length, anchorIndex + radius + 1),
  );
}

function getParagraphsByIds(readerParagraphs: Paragraph[], paragraphIds: string[]) {
  const paragraphsById = new Map(readerParagraphs.map((paragraph) => [paragraph.id, paragraph]));

  return paragraphIds
    .map((paragraphId) => paragraphsById.get(paragraphId) ?? null)
    .filter((paragraph): paragraph is Paragraph => paragraph !== null);
}

function normalizeVisibleParagraphIds(
  visibleParagraphIds: string[] | undefined,
  readerParagraphs: Paragraph[],
  fallbackParagraphId?: string,
) {
  const knownParagraphIds = new Set(readerParagraphs.map((paragraph) => paragraph.id));
  const normalizedIds: string[] = [];

  for (const paragraphId of visibleParagraphIds ?? []) {
    if (knownParagraphIds.has(paragraphId) && !normalizedIds.includes(paragraphId)) {
      normalizedIds.push(paragraphId);
    }
  }

  if (normalizedIds.length === 0 && fallbackParagraphId && knownParagraphIds.has(fallbackParagraphId)) {
    normalizedIds.push(fallbackParagraphId);
  }

  return normalizedIds;
}

function capAssistContextBlocks(contextBlocks: AssistContextBlockPayload[]): AssistContextBlockPayload[] {
  const cappedBlocks: AssistContextBlockPayload[] = [];
  let remainingChars = assistContextMaxChars;

  for (const block of contextBlocks) {
    const text = normalizeSelectionText(block.text);

    if (!text || remainingChars <= 0) {
      continue;
    }

    const blockText =
      text.length > Math.min(assistContextBlockMaxChars, remainingChars)
        ? `${text.slice(0, Math.max(0, Math.min(assistContextBlockMaxChars, remainingChars) - 3)).trim()}...`
        : text;

    cappedBlocks.push({
      ...block,
      text: blockText,
    });
    remainingChars -= blockText.length;
  }

  return cappedBlocks;
}

function getLegacyParagraphText(contextBlocks: AssistContextBlockPayload[]) {
  return contextBlocks
    .map((block) => block.text)
    .join('\n\n')
    .slice(0, 8000)
    .trim();
}

function createSummarySelection(
  readerBook: ReaderBook,
  readingLocation: ReadingLocation | null,
  visibleParagraphIds: string[],
): ReaderSelection | null {
  const anchorParagraphId = getSummaryAnchorParagraphId(readerBook, readingLocation, visibleParagraphIds);

  if (!anchorParagraphId) {
    return null;
  }

  const normalizedVisibleParagraphIds = normalizeVisibleParagraphIds(
    visibleParagraphIds,
    readerBook.paragraphs,
    anchorParagraphId,
  );

  return {
    contextScope: 'visiblePage',
    id: `summary:${anchorParagraphId}:${hashString(normalizedVisibleParagraphIds.join('\n'))}`,
    paragraphId: anchorParagraphId,
    selectionKind: 'paragraph',
    text: summarySelectionText,
    visibleParagraphIds: normalizedVisibleParagraphIds,
  };
}

function getSummaryAnchorParagraphId(
  readerBook: ReaderBook,
  readingLocation: ReadingLocation | null,
  visibleParagraphIds: string[],
) {
  const readingParagraphId =
    readingLocation && getParagraphById(readingLocation.paragraphId, readerBook.paragraphs)
      ? readingLocation.paragraphId
      : null;
  const visibleParagraphId = normalizeVisibleParagraphIds(visibleParagraphIds, readerBook.paragraphs)[0];

  return readingParagraphId ?? visibleParagraphId ?? readerBook.paragraphs[0]?.id ?? null;
}

function isSupportedEpubAsset(asset: DocumentPickerAsset) {
  const fileName = asset.name.toLowerCase();
  const mimeType = asset.mimeType?.toLowerCase() ?? '';

  return fileName.endsWith('.epub') || mimeType === 'application/epub+zip';
}

function isSupportedPdfAsset(asset: DocumentPickerAsset) {
  const fileName = asset.name.toLowerCase();
  const mimeType = asset.mimeType?.toLowerCase() ?? '';

  return fileName.endsWith('.pdf') || mimeType === 'application/pdf';
}

function getUnsupportedImportMessage(asset: DocumentPickerAsset) {
  const fileName = asset.name.toLowerCase();
  const mimeType = asset.mimeType?.toLowerCase() ?? '';
  const isPdf = fileName.endsWith('.pdf') || mimeType === 'application/pdf';
  const isImage = mimeType.startsWith('image/') || /\.(heic|jpe?g|png|tiff?|webp)$/.test(fileName);

  if (isPdf) {
    return Platform.OS === 'ios'
      ? 'This file looks like a PDF, but it could not be recognized as one.'
      : 'PDF import is currently available on iPhone and iPad.';
  }

  if (isImage) {
    return 'Image and scan import are not available yet. They will land with the OCR pipeline.';
  }

  return 'Choose an EPUB or PDF file. Use the camera button for a single image or scanned page.';
}

function toReaderBook(parsedBook: ParsedEpubBook): ReaderBook {
  const paragraphs = withParagraphSourceRefs(parsedBook.paragraphs, 'epub', parsedBook.fileName);

  return {
    author: parsedBook.author,
    chapters: parsedBook.chapters,
    fileName: parsedBook.fileName,
    page: 'Imported EPUB',
    paragraphs,
    progress: `${parsedBook.paragraphs.length} paragraphs`,
    source: 'epub',
    sourceDetail: {
      blockCount: paragraphs.length,
      fileName: parsedBook.fileName,
      source: 'epub',
    },
    title: parsedBook.title,
  };
}

async function requestApplePdfImport(documentUri: string): Promise<PdfImportResult> {
  if (Platform.OS !== 'ios') {
    throw new Error('PDF import is currently available on iPhone and iPad.');
  }

  if (!applePdfImport) {
    throw new Error('On-device PDF import is unavailable in this build. Reinstall the latest development build.');
  }

  const data = await applePdfImport.extractDocument(documentUri);

  if (!isPdfImportResult(data)) {
    throw new Error('On-device PDF import returned an unexpected result.');
  }

  return data;
}

function toPdfReaderBook(pdfResult: PdfImportResult, asset: DocumentPickerAsset): ReaderBook {
  const fileName = asset.name;
  const pdfId = `pdf-${hashString(`${fileName}:${asset.size ?? 0}`)}`;
  const sortedPages = [...pdfResult.pages].sort((first, second) => first.pageIndex - second.pageIndex);
  let blockIndex = 0;
  const paragraphs: Paragraph[] = [];
  const firstParagraphByPage = new Map<number, string>();

  for (const page of sortedPages) {
    for (const block of page.blocks) {
      const paragraphId = `${pdfId}-page-${page.pageIndex + 1}-block-${blockIndex + 1}`;
      const sourceRef: DocumentSourceRef = {
        blockId: paragraphId,
        blockIndex,
        boundingBox: block.boundingBox,
        fileName,
        ocrConfidence: block.confidence,
        pageIndex: page.pageIndex,
        pageLabel: page.pageLabel,
        source: 'pdf',
      };

      if (!firstParagraphByPage.has(page.pageIndex)) {
        firstParagraphByPage.set(page.pageIndex, paragraphId);
      }

      paragraphs.push({
        blockKind: block.blockKind,
        id: paragraphId,
        segments: [
          {
            id: `${paragraphId}-text`,
            paragraphId,
            selectionKind: 'paragraph',
            sourceRef,
            text: normalizeSelectionText(block.text),
          },
        ],
        sourceRef,
      });
      blockIndex += 1;
    }
  }

  const allOutlineEntries = pdfResult.outline;
  const depthsPresent = allOutlineEntries.map((e) => e.depth ?? 0);
  const minOutlineDepth = depthsPresent.length > 0 ? Math.min(...depthsPresent) : 0;
  const topLevelOutline = allOutlineEntries.filter((e) => (e.depth ?? 0) === minOutlineDepth);
  const filteredOutlineEntries =
    topLevelOutline.length >= 2
      ? topLevelOutline
      : allOutlineEntries.filter((e) => (e.depth ?? 0) <= minOutlineDepth + 1);
  const outlineChapters = filteredOutlineEntries
    .map((entry, index) => {
      const paragraphId = firstParagraphByPage.get(entry.pageIndex);
      return paragraphId
        ? {
            id: `${pdfId}-outline-${index + 1}`,
            paragraphId,
            title: normalizeSelectionText(entry.title) || `Page ${entry.pageIndex + 1}`,
          }
        : null;
    })
    .filter((chapter): chapter is ReaderChapter => chapter !== null);
  const pageChapters = sortedPages
    .map((page) => {
      const paragraphId = firstParagraphByPage.get(page.pageIndex);
      return paragraphId
        ? {
            id: `${pdfId}-page-${page.pageIndex + 1}`,
            paragraphId,
            title: page.pageLabel,
          }
        : null;
    })
    .filter((chapter): chapter is ReaderChapter => chapter !== null);
  const chapters = outlineChapters.length > 0 ? outlineChapters : pageChapters;
  const title = normalizeSelectionText(pdfResult.title) || fileName.replace(/\.pdf$/i, '') || 'Imported PDF';

  return {
    author: normalizeSelectionText(pdfResult.author) || 'Unknown author',
    chapters,
    fileName,
    page: `Page 1 of ${pdfResult.pageCount}`,
    paragraphs: withParagraphSourceRefs(paragraphs, 'pdf', fileName),
    progress: pdfResult.pageCount > 0 ? `${Math.round(100 / pdfResult.pageCount)}%` : '0%',
    source: 'pdf',
    sourceDetail: {
      blockCount: paragraphs.length,
      fileName,
      pageCount: pdfResult.pageCount,
      source: 'pdf',
    },
    title,
  };
}

function toScanReaderBook(ocrResult: OcrExtractResponse, asset: ImagePicker.ImagePickerAsset): ReaderBook {
  const createdAt = new Date();
  const scanId = `scan-${createdAt.getTime().toString(36)}`;
  const blocks = getOcrTextBlocks(ocrResult);
  const fileName = asset.fileName ?? `${scanId}.jpg`;
  const paragraphs = withParagraphSourceRefs(
    blocks.map((block, index) => {
      const paragraphId = `${scanId}-p-${index + 1}`;
      const sourceRef: DocumentSourceRef = {
        blockId: paragraphId,
        blockIndex: index,
        boundingBox: block.boundingBox,
        fileName,
        imageUri: asset.uri,
        ocrConfidence: block.confidence ?? undefined,
        pageIndex: 0,
        pageLabel: 'page 1',
        source: 'scan',
      };

      return {
        blockKind: 'body',
        id: paragraphId,
        segments: [
          {
            id: `${paragraphId}-text`,
            paragraphId,
            selectionKind: 'paragraph',
            sourceRef,
            text: block.text,
          },
        ],
        sourceRef,
      };
    }),
    'scan',
    fileName,
  );

  return {
    author: normalizeSelectionText(ocrResult.author) || 'Scanned page',
    chapters: paragraphs[0] ? [{ id: `${scanId}-chapter`, paragraphId: paragraphs[0].id, title: 'Scanned page' }] : [],
    fileName,
    page: 'Scan page 1',
    paragraphs,
    progress: `${paragraphs.length} scanned blocks`,
    source: 'scan',
    sourceDetail: {
      blockCount: paragraphs.length,
      fileName,
      pageCount: 1,
      source: 'scan',
    },
    title: normalizeSelectionText(ocrResult.title) || `Scanned page - ${formatScanDate(createdAt)}`,
  };
}

function getOcrTextBlocks(ocrResult: OcrExtractResponse): OcrTextBlockResponse[] {
  const structuredBlocks = Array.isArray(ocrResult.blocks) ? ocrResult.blocks : [];
  const blocks = structuredBlocks.length > 0 ? structuredBlocks : splitOcrTextIntoBlocks(ocrResult.text);

  return blocks
    .map((block) => ({
      boundingBox: block.boundingBox,
      confidence: block.confidence ?? undefined,
      text: normalizeSelectionText(block.text),
    }))
    .filter((block) => block.text.length > 0);
}

function splitOcrTextIntoBlocks(text: string): OcrTextBlockResponse[] {
  return text
    .split(/\n{2,}/)
    .map((block) => normalizeSelectionText(block))
    .filter((block) => block.length > 0)
    .map((block) => ({ text: block }));
}

function formatScanDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

function createLibraryItem(book: ReaderBook): LibraryItem {
  const timestamp = new Date().toISOString();
  const hydratedBook = hydrateReaderBook(book);

  return {
    book: hydratedBook,
    conversation: [],
    id: createLibraryItemId(hydratedBook, timestamp),
    importedAt: timestamp,
    lastOpenedAt: timestamp,
    readingLocation: getInitialReadingLocation(hydratedBook),
    savedInsights: [],
    wholeBookAi: defaultWholeBookAiState,
  };
}

function createLibraryItemId(book: ReaderBook, timestamp: string) {
  return `${book.source}:${slugify(book.title)}:${hashString(`${timestamp}:${book.title}:${book.fileName ?? ''}`)}`;
}

function createMigratedLibraryItem(
  book: ReaderBook,
  readingLocation: ReadingLocation | null,
  savedInsights: SavedInsight[],
): LibraryItem {
  const hydratedBook = hydrateReaderBook(book);
  const importedAt = hydratedBook.source === 'sample' ? 'sample' : new Date().toISOString();
  const restoredLocation = hydrateReadingLocation(readingLocation, hydratedBook);

  return {
    book: hydratedBook,
    conversation: [],
    id: hydratedBook.source === 'sample' ? sampleLibraryItem.id : createLibraryItemId(hydratedBook, importedAt),
    importedAt,
    lastOpenedAt: importedAt,
    readingLocation: restoredLocation,
    savedInsights: hydrateSavedInsightSourceRefs(savedInsights, hydratedBook),
    wholeBookAi: defaultWholeBookAiState,
  };
}

function getActiveLibraryItem(libraryItems: LibraryItem[], activeBookId: string) {
  return libraryItems.find((item) => item.id === activeBookId) ?? libraryItems[0] ?? sampleLibraryItem;
}

function getLibraryItemProgress(item: LibraryItem) {
  return getReaderProgress(item.book, item.readingLocation);
}

function getSearchResults(
  readerBook: ReaderBook,
  savedInsights: SavedInsight[],
  query: string,
  scope: SearchScope,
): SearchResult[] {
  const normalizedQuery = normalizeSelectionText(query).toLowerCase();

  if (normalizedQuery.length < 2) {
    return [];
  }

  const results: SearchResult[] = [];

  if (scope === 'book' || scope === 'all') {
    results.push(...getBookSearchResults(readerBook, normalizedQuery));
  }

  if (scope === 'notes' || scope === 'all') {
    results.push(...getSavedNoteSearchResults(savedInsights, normalizedQuery));
  }

  return results.slice(0, 60);
}

function getBookSearchResults(readerBook: ReaderBook, normalizedQuery: string): SearchResult[] {
  const results: Array<SearchResult | null> = readerBook.paragraphs.map((paragraph, paragraphIndex) => {
    const paragraphText = normalizeSelectionText(getParagraphText(paragraph));
    const matchIndex = paragraphText.toLowerCase().indexOf(normalizedQuery);

    if (matchIndex < 0) {
      return null;
    }

    return {
      excerpt: createSearchExcerpt(paragraphText, matchIndex, normalizedQuery.length),
      id: `book:${paragraph.id}`,
      index: paragraphIndex + 1,
      kind: 'book',
      paragraphId: paragraph.id,
      sourceLabel: formatSourceRef(paragraph.sourceRef),
      title: `Paragraph ${paragraphIndex + 1}`,
    };
  });

  return results.filter((result): result is SearchResult => result !== null).slice(0, 40);
}

function getSavedNoteSearchResults(savedInsights: SavedInsight[], normalizedQuery: string): SearchResult[] {
  const results: Array<SearchResult | null> = [...savedInsights]
    .sort((firstNote, secondNote) => secondNote.createdAt.localeCompare(firstNote.createdAt))
    .map((note) => {
      // `question` and `eyebrow` are both searched: a thread note's question lives in
      // `question`, but one saved before that field existed still has it in `eyebrow`.
      const searchableFields = [
        note.selectedText,
        note.body,
        note.userNote ?? '',
        note.question ?? '',
        note.eyebrow,
        getInsightActionLabel(note.action),
      ];
      const matchedField = searchableFields.find((field) =>
        normalizeSelectionText(field).toLowerCase().includes(normalizedQuery),
      );

      if (!matchedField) {
        return null;
      }

      const normalizedField = normalizeSelectionText(matchedField);
      const matchIndex = normalizedField.toLowerCase().indexOf(normalizedQuery);

      return {
        excerpt: createSearchExcerpt(normalizedField, Math.max(0, matchIndex), normalizedQuery.length),
        id: `note:${note.id}`,
        kind: 'note',
        noteId: note.id,
        paragraphId: note.paragraphId,
        sourceLabel: formatSourceRef(note.sourceRef),
        title: `Note - ${getInsightActionLabel(note.action)}`,
      };
    });

  return results.filter((result): result is SearchResult => result !== null).slice(0, 40);
}

function createSearchExcerpt(text: string, matchIndex: number, matchLength: number) {
  const excerptRadius = 72;
  const start = Math.max(0, matchIndex - excerptRadius);
  const end = Math.min(text.length, matchIndex + matchLength + excerptRadius);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';

  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function formatSearchResultMeta(result: SearchResult) {
  return result.sourceLabel ? `${result.title} - ${result.sourceLabel}` : result.title;
}

function formatSourceRef(sourceRef?: DocumentSourceRef) {
  if (!sourceRef) {
    return undefined;
  }

  const sourceLabel = getDocumentSourceLabel(sourceRef.source);

  if (sourceRef.pageLabel) {
    return `${sourceLabel} ${sourceRef.pageLabel}`;
  }

  if (typeof sourceRef.pageIndex === 'number') {
    return `${sourceLabel} page ${sourceRef.pageIndex + 1}`;
  }

  if (typeof sourceRef.blockIndex === 'number') {
    return `${sourceLabel} block ${sourceRef.blockIndex + 1}`;
  }

  return sourceLabel;
}

function getDocumentSourceLabel(source: DocumentSource) {
  switch (source) {
    case 'epub':
      return 'EPUB';
    case 'pdf':
      return 'PDF';
    case 'scan':
      return 'Scan';
    default:
      return 'Sample';
  }
}

function formatBookSourceMeta(book: ReaderBook) {
  const sourceLabel = getDocumentSourceLabel(book.source);
  const blockCount = book.sourceDetail?.blockCount ?? book.paragraphs.length;

  if (book.source === 'sample') {
    return 'Sample';
  }

  if (book.source === 'pdf' && book.sourceDetail?.pageCount) {
    const pageCount = book.sourceDetail.pageCount;
    return `${sourceLabel} - ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;
  }

  return blockCount > 0 ? `${sourceLabel} - ${blockCount} blocks` : sourceLabel;
}

function toExportableNote(note: SavedInsight): ExportableNote {
  // question/selectedText are normalized (whitespace collapsed) here, before savedNoteExport's
  // formatters gate on them, so a whitespace-only field normalizes to '' and is treated as
  // absent (no empty "Selected: " line). This is an intentional improvement over the
  // pre-refactor behavior, which gated on the raw field and could emit a label with nothing
  // after it. `body` only gets trimmed, not whitespace-collapsed: it's the AI's Markdown
  // answer, and collapsing runs of whitespace would erase the newlines its bullet/numbered
  // lists depend on (see parseAnswerMarkdown), flattening them into one unreadable line.
  return {
    actionLabel: getInsightActionLabel(note.action),
    body: note.body.trim(),
    citations: note.citations?.map((citation) => ({
      // `?? undefined` guards a citation persisted with JSON `null` before saveChatTurn
      // normalized these at the API boundary — see formatCitationLabel.
      chapterTitle: citation.chapterTitle ?? undefined,
      excerpt: normalizeSelectionText(citation.excerpt),
      pageIndex: citation.pageIndex ?? undefined,
      pageLabel: citation.pageLabel ?? undefined,
    })),
    createdAt: note.createdAt,
    // Only an `ask` note has a question: for one saved before the `question` field existed
    // it is still sitting in `eyebrow`, so fall back to that rather than exporting no Q line.
    // Every other action's eyebrow is an AI label, never a question, so it stays out.
    question: note.action === 'ask' ? normalizeSelectionText(note.question ?? note.eyebrow) : '',
    selectedText: normalizeSelectionText(note.selectedText),
    sourceLabel: formatSourceRef(note.sourceRef),
    userNote: normalizeSelectionText(note.userNote ?? '') || undefined,
  };
}

function formatSavedInsightsForExport(readerBook: ReaderBook, savedInsights: SavedInsight[]) {
  const sortedNotes = [...savedInsights].sort((firstNote, secondNote) =>
    firstNote.createdAt.localeCompare(secondNote.createdAt),
  );
  const header = `${readerBook.title}\n${readerBook.author}\nSaved notes`;
  const body = sortedNotes
    .map((note, index) => formatNoteAsText(toExportableNote(note), index))
    .join('\n\n');

  return body ? `${header}\n\n${body}` : header;
}

function formatSavedInsightsAsMarkdown(readerBook: ReaderBook, savedInsights: SavedInsight[]) {
  const sortedNotes = [...savedInsights].sort((firstNote, secondNote) =>
    firstNote.createdAt.localeCompare(secondNote.createdAt),
  );
  const header = `# ${readerBook.title}\n\n_${readerBook.author}_`;
  const body = sortedNotes
    .map((note, index) => formatNoteAsMarkdown(toExportableNote(note), index))
    .join('\n\n---\n\n');

  return body ? `${header}\n\n---\n\n${body}\n` : `${header}\n`;
}

function slugifyForFileName(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'book';
}

async function exportSavedInsightsAsMarkdown(readerBook: ReaderBook, savedInsights: SavedInsight[]) {
  const canShare = await Sharing.isAvailableAsync();

  if (!canShare) {
    throw new Error('Sharing is not available on this device.');
  }

  const markdown = formatSavedInsightsAsMarkdown(readerBook, savedInsights);
  const fileUri = `${FileSystem.cacheDirectory}${slugifyForFileName(readerBook.title)}-notes.md`;

  await FileSystem.writeAsStringAsync(fileUri, markdown);
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/markdown',
    dialogTitle: 'Export saved notes',
    UTI: 'net.daringfireball.markdown',
  });
}

function createSavedInsightId(selection: ReaderSelection, action: InsightAction, insight: Insight) {
  return `insight:${hashString(
    [selection.paragraphId, normalizeSelectionText(selection.text), action, insight.body].join('\n'),
  )}`;
}

function createHighlightId(selection: ReaderSelection) {
  return `highlight:${hashString([selection.paragraphId, normalizeSelectionText(selection.text)].join('\n'))}`;
}

function isHighlightMatch(note: SavedInsight, selection: ReaderSelection) {
  return (
    note.action === 'highlight' &&
    note.paragraphId === selection.paragraphId &&
    normalizeSelectionText(note.selectedText) === normalizeSelectionText(selection.text)
  );
}

const chatInsightIdPrefix = 'chat:';

function createChatInsightId(turn: ConversationTurn) {
  return `${chatInsightIdPrefix}${turn.id}`;
}

// The question, the passage it was asked about, and that passage's location all live on
// the *user* turn — an assistant turn only carries its answer text and citations. Saving
// an answer therefore has to look back one turn to recover any of its context.
function findPrecedingUserTurn(conversation: ConversationTurn[], turn: ConversationTurn) {
  const index = conversation.findIndex((candidate) => candidate.id === turn.id);
  const preceding = index > 0 ? conversation[index - 1] : null;

  return preceding && preceding.role === 'user' ? preceding : null;
}

function isSavedInsightMatch(
  note: SavedInsight,
  selection: ReaderSelection,
  action: InsightAction,
  insight: Insight,
) {
  return (
    note.action === action &&
    note.paragraphId === selection.paragraphId &&
    normalizeSelectionText(note.selectedText) === normalizeSelectionText(selection.text) &&
    note.body === insight.body
  );
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);

  return slug || 'book';
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

async function readPersistedReaderState(): Promise<PersistedReaderState | null> {
  if (!readerStatePath) {
    return null;
  }

  const fileInfo = await FileSystem.getInfoAsync(readerStatePath);

  if (!fileInfo.exists) {
    return null;
  }

  const rawState = await FileSystem.readAsStringAsync(readerStatePath);
  const parsedState: unknown = JSON.parse(rawState);
  return coercePersistedReaderState(parsedState);
}

async function writePersistedReaderState(state: PersistedReaderState) {
  if (!readerStatePath) {
    return;
  }

  await FileSystem.writeAsStringAsync(readerStatePath, JSON.stringify(state));
}

function coercePersistedReaderState(value: unknown): PersistedReaderState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (Array.isArray(value.libraryItems)) {
    // isLibraryItem deliberately does not validate individual saved notes; they are
    // filtered here instead. One unparseable note then costs only that note — the book,
    // its reading position, conversation, mind-map state and every other note survive.
    // Same resilience as the legacy single-book path below, which already filters.
    const libraryItems = value.libraryItems.filter(isLibraryItem).map((item) =>
      migrateLibraryItem(
        hydrateLibraryItem({ ...item, savedInsights: item.savedInsights.filter(isSavedInsight) }),
      ),
    );

    if (libraryItems.length === 0) {
      return null;
    }

    const activeBookId =
      typeof value.activeBookId === 'string' && libraryItems.some((item) => item.id === value.activeBookId)
        ? value.activeBookId
        : libraryItems[0].id;

    return {
      activeBookId,
      libraryItems,
      schemaVersion: LIBRARY_SCHEMA_VERSION,
    };
  }

  if (isReaderBook(value.currentBook)) {
    const savedInsights = Array.isArray(value.savedInsights)
      ? value.savedInsights.filter(isSavedInsight)
      : [];
    const readingLocation = isReadingLocation(value.readingLocation) ? value.readingLocation : null;
    const migratedItem = createMigratedLibraryItem(value.currentBook, readingLocation, savedInsights);

    return {
      activeBookId: migratedItem.id,
      libraryItems: [migratedItem],
      schemaVersion: LIBRARY_SCHEMA_VERSION,
    };
  }

  return null;
}

// Checks everything that makes an item usable, but only that `savedInsights` is an array —
// NOT that every note in it validates. A single bad note must not cost the reader the whole
// book, so notes are sanitized by the caller (coercePersistedReaderState) with
// `.filter(isSavedInsight)`; nothing else may consume this predicate without doing the same.
function isLibraryItem(value: unknown): value is LibraryItem {
  if (!isRecord(value) || !isReaderBook(value.book) || typeof value.id !== 'string') {
    return false;
  }

  return (
    typeof value.importedAt === 'string' &&
    typeof value.lastOpenedAt === 'string' &&
    (value.readingLocation === null || isReadingLocation(value.readingLocation)) &&
    Array.isArray(value.savedInsights)
  );
}

function isReaderBook(value: unknown): value is ReaderBook {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.author === 'string' &&
    typeof value.page === 'string' &&
    typeof value.progress === 'string' &&
    isDocumentSource(value.source) &&
    typeof value.title === 'string' &&
    Array.isArray(value.chapters) &&
    Array.isArray(value.paragraphs) &&
    value.chapters.every(isReaderChapter) &&
    value.paragraphs.every(isParagraph) &&
    (value.sourceDetail === undefined || isReaderSourceDetail(value.sourceDetail))
  );
}

function isDocumentSource(value: unknown): value is DocumentSource {
  return value === 'epub' || value === 'pdf' || value === 'sample' || value === 'scan';
}

function isReaderSourceDetail(value: unknown): value is ReaderSourceDetail {
  return (
    isRecord(value) &&
    isDocumentSource(value.source) &&
    (value.blockCount === undefined || isFiniteNumber(value.blockCount)) &&
    (value.fileName === undefined || typeof value.fileName === 'string') &&
    (value.pageCount === undefined || isFiniteNumber(value.pageCount))
  );
}

function isDocumentSourceRef(value: unknown): value is DocumentSourceRef {
  return (
    isRecord(value) &&
    isDocumentSource(value.source) &&
    (value.anchor === undefined || typeof value.anchor === 'string') &&
    (value.blockId === undefined || typeof value.blockId === 'string') &&
    (value.blockIndex === undefined || isFiniteNumber(value.blockIndex)) &&
    (value.boundingBox === undefined || isDocumentBoundingBox(value.boundingBox)) &&
    (value.fileName === undefined || typeof value.fileName === 'string') &&
    (value.href === undefined || typeof value.href === 'string') &&
    (value.imageUri === undefined || typeof value.imageUri === 'string') &&
    (value.ocrConfidence === undefined || isFiniteNumber(value.ocrConfidence)) &&
    (value.pageIndex === undefined || isFiniteNumber(value.pageIndex)) &&
    (value.pageLabel === undefined || typeof value.pageLabel === 'string')
  );
}

function isDocumentBoundingBox(value: unknown): value is DocumentBoundingBox {
  return (
    isRecord(value) &&
    isFiniteNumber(value.height) &&
    (value.unit === 'px' || value.unit === 'ratio') &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isReaderChapter(value: unknown): value is ReaderChapter {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.paragraphId === 'string' &&
    typeof value.title === 'string'
  );
}

function isParagraph(value: unknown): value is Paragraph {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Array.isArray(value.segments) &&
    value.segments.every(isPassageSegment) &&
    (value.sourceRef === undefined || isDocumentSourceRef(value.sourceRef))
  );
}

function isPassageSegment(value: unknown): value is PassageSegment {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.paragraphId === 'string' &&
    typeof value.text === 'string' &&
    (value.selectionKind === undefined ||
      value.selectionKind === 'word' ||
      value.selectionKind === 'phrase' ||
      value.selectionKind === 'paragraph') &&
    (value.sourceRef === undefined || isDocumentSourceRef(value.sourceRef))
  );
}

function isReadingLocation(value: unknown): value is ReadingLocation {
  return (
    isRecord(value) &&
    typeof value.paragraphId === 'string' &&
    (value.sourceRef === undefined || isDocumentSourceRef(value.sourceRef))
  );
}

function isSavedInsight(value: unknown): value is SavedInsight {
  return (
    isRecord(value) &&
    isInsightAction(value.action) &&
    typeof value.body === 'string' &&
    typeof value.bookTitle === 'string' &&
    (value.citations === undefined ||
      (Array.isArray(value.citations) && value.citations.every(isSavedCitation))) &&
    typeof value.createdAt === 'string' &&
    typeof value.eyebrow === 'string' &&
    typeof value.id === 'string' &&
    typeof value.paragraphId === 'string' &&
    (value.question === undefined || typeof value.question === 'string') &&
    typeof value.selectedText === 'string' &&
    (value.selectionKind === 'word' || value.selectionKind === 'phrase' || value.selectionKind === 'paragraph') &&
    (value.sourceRef === undefined || isDocumentSourceRef(value.sourceRef)) &&
    (value.updatedAt === undefined || typeof value.updatedAt === 'string') &&
    (value.userNote === undefined || typeof value.userNote === 'string')
  );
}

function isSavedCitation(value: unknown): value is SavedCitation {
  return (
    isRecord(value) &&
    typeof value.excerpt === 'string' &&
    typeof value.paragraphId === 'string' &&
    isDocumentSourceRef(value.sourceRef) &&
    (value.chapterTitle === undefined || typeof value.chapterTitle === 'string') &&
    (value.pageIndex === undefined || isFiniteNumber(value.pageIndex)) &&
    (value.pageLabel === undefined || typeof value.pageLabel === 'string')
  );
}

// Thread notes are titled by their question; highlights and inline insights keep the
// AI's eyebrow. One place, so the list and editor can't disagree. Export deliberately
// does NOT use this — an eyebrow is a label, not a question.
function getSavedNoteHeadline(note: SavedInsight): string {
  return note.question || note.eyebrow;
}

// "Does this note have, or can it have, an editable question?" — `undefined` means no
// question field at all (a Highlight or an inline Explain must never gain one). An `ask`
// note saved before the `question` field existed carries its question in `eyebrow`, so it
// seeds the editor from there rather than opening blank. One place, so the editor's render
// condition, the seed value, and the save guard can't drift apart.
function getEditableSavedNoteQuestion(note: SavedInsight): string | undefined {
  if (note.question !== undefined) {
    return note.question;
  }

  return note.action === 'ask' ? note.eyebrow : undefined;
}

function isInsightAction(value: unknown): value is InsightAction {
  return (
    value === 'explain' ||
    value === 'example' ||
    value === 'rephrase' ||
    value === 'ask' ||
    value === 'simpler' ||
    value === 'summarize' ||
    value === 'highlight'
  );
}

function getInitialReadingLocation(readerBook: ReaderBook): ReadingLocation | null {
  const firstParagraphId = readerBook.paragraphs[0]?.id;
  return firstParagraphId
    ? {
        paragraphId: firstParagraphId,
        sourceRef: getParagraphSourceRef(firstParagraphId, readerBook),
      }
    : null;
}

function getReaderProgress(readerBook: ReaderBook, readingLocation: ReadingLocation | null): ReaderProgress {
  if (readerBook.source === 'sample') {
    return {
      page: readerBook.page,
      percent: parseProgressPercent(readerBook.progress) ?? 22,
      progress: readerBook.progress,
    };
  }

  const pageCount = readerBook.sourceDetail?.pageCount;
  const pageIndex = readingLocation?.sourceRef?.pageIndex;

  if ((readerBook.source === 'pdf' || readerBook.source === 'scan') && pageCount && typeof pageIndex === 'number') {
    const currentPage = Math.min(pageCount, Math.max(1, pageIndex + 1));
    const percent = Math.min(100, Math.max(1, Math.round((currentPage / pageCount) * 100)));

    return {
      page: `Page ${currentPage} of ${pageCount}`,
      percent,
      progress: `${percent}%`,
    };
  }

  const totalParagraphs = readerBook.paragraphs.length;

  if (totalParagraphs === 0) {
    return {
      page: readerBook.page,
      percent: 0,
      progress: readerBook.progress,
    };
  }

  const locationIndex = readingLocation
    ? readerBook.paragraphs.findIndex((paragraph) => paragraph.id === readingLocation.paragraphId)
    : -1;
  const currentParagraph = Math.max(1, locationIndex >= 0 ? locationIndex + 1 : 1);
  const percent = Math.min(100, Math.max(1, Math.round((currentParagraph / totalParagraphs) * 100)));

  return {
    page: `Paragraph ${currentParagraph} of ${totalParagraphs}`,
    percent,
    progress: `${percent}%`,
  };
}

function parseProgressPercent(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)%/);
  return match ? Math.min(100, Math.max(0, Number(match[1]))) : null;
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

async function requestOcr(payload: OcrRequestPayload, token: string): Promise<OcrExtractResponse> {
  const ocrUrl = `${apiBaseUrl}/ocr/extract`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ocrRequestTimeoutMs);
  const requestStartedAt = Date.now();
  let response: Response;

  try {
    response = await fetch(ocrUrl, {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('This scan took too long. The current page was not changed. Try a closer, flatter capture.');
    }

    throw new Error(`The scan failed and the current page was not changed. Could not reach ${ocrUrl}. ${getErrorMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorDetail = await readResponseError(response);
    throw new Error(
      errorDetail
        ? `The scan failed and the current page was not changed. ${errorDetail}`
        : `The scan failed with status ${response.status}. The current page was not changed.`,
    );
  }

  const data: unknown = await response.json();

  if (!isOcrExtractResponse(data)) {
    throw new Error('OCR response was not in the expected format.');
  }

  console.info('[OCR] request complete', {
    requestMs: Date.now() - requestStartedAt,
    serverMs: Number(response.headers.get('x-ocr-processing-ms')) || undefined,
  });

  return data;
}

async function requestAppleVisionOcr(imageUri: string): Promise<OcrExtractResponse | null> {
  if (Platform.OS !== 'ios') {
    return null;
  }

  if (!appleVisionOcr) {
    throw new Error('On-device OCR is unavailable in this iPhone build. Reinstall the latest development build.');
  }

  const requestStartedAt = Date.now();
  const data = await appleVisionOcr.recognizeText(imageUri);

  if (!isOcrExtractResponse(data)) {
    throw new Error('On-device OCR returned an unexpected result.');
  }

  console.info('[OCR] Apple Vision complete', {
    blocks: data.blocks.length,
    requestMs: Date.now() - requestStartedAt,
    textCharacters: data.text.length,
  });
  return data;
}

async function prepareOcrImage(asset: ImagePicker.ImagePickerAsset): Promise<PreparedOcrImage> {
  const longestDimension = Math.max(asset.width, asset.height);
  const resizeAction =
    longestDimension > ocrImageMaxDimension
      ? asset.width >= asset.height
        ? [{ resize: { width: ocrImageMaxDimension } }]
        : [{ resize: { height: ocrImageMaxDimension } }]
      : [];
  const result = await ImageManipulator.manipulateAsync(asset.uri, resizeAction, {
    base64: true,
    compress: ocrImageCompression,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  if (!result.base64) {
    throw new Error('The captured image could not be prepared for OCR.');
  }

  return {
    dataUrl: `data:image/jpeg;base64,${result.base64}`,
    height: result.height,
    payloadBytes: Math.ceil((result.base64.length * 3) / 4),
    width: result.width,
  };
}

function getScanStageLabel(stage: ScanStage) {
  switch (stage) {
    case 'capturing':
      return 'Opening camera...';
    case 'preparing':
      return 'Preparing image...';
    case 'reading':
      return Platform.OS === 'ios' ? 'Reading page on device...' : 'Reading page...';
    case 'uploading':
      return 'Using cloud OCR...';
    default:
      return null;
  }
}

function isOcrExtractResponse(value: unknown): value is OcrExtractResponse {
  return (
    isRecord(value) &&
    typeof value.author === 'string' &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isOcrTextBlockResponse) &&
    (value.language === undefined || value.language === null || typeof value.language === 'string') &&
    typeof value.text === 'string' &&
    typeof value.title === 'string'
  );
}

function isPdfImportResult(value: unknown): value is PdfImportResult {
  return (
    isRecord(value) &&
    typeof value.author === 'string' &&
    Array.isArray(value.outline) &&
    value.outline.every(
      (entry) =>
        isRecord(entry) && isFiniteNumber(entry.pageIndex) && typeof entry.title === 'string',
    ) &&
    isFiniteNumber(value.pageCount) &&
    Array.isArray(value.pages) &&
    value.pages.every(isPdfImportPageResponse) &&
    typeof value.title === 'string'
  );
}

function isPdfImportPageResponse(value: unknown): value is PdfImportPageResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isPdfImportBlockResponse) &&
    isFiniteNumber(value.pageIndex) &&
    typeof value.pageLabel === 'string' &&
    typeof value.usedOcr === 'boolean'
  );
}

function isPdfImportBlockResponse(value: unknown): value is PdfImportBlockResponse {
  return (
    isRecord(value) &&
    isReaderBlockKind(value.blockKind) &&
    (value.boundingBox === undefined || isDocumentBoundingBox(value.boundingBox)) &&
    (value.confidence === undefined || isFiniteNumber(value.confidence)) &&
    typeof value.text === 'string'
  );
}

function isReaderBlockKind(value: unknown): value is ReaderBlockKind {
  return (
    value === 'body' ||
    value === 'chapterNumber' ||
    value === 'chapterTitle' ||
    value === 'sectionHeading' ||
    value === 'subheading' ||
    value === 'quote' ||
    value === 'listItem'
  );
}

function isOcrTextBlockResponse(value: unknown): value is OcrTextBlockResponse {
  return (
    isRecord(value) &&
    typeof value.text === 'string' &&
    (value.boundingBox === undefined || isDocumentBoundingBox(value.boundingBox)) &&
    (value.confidence === undefined || value.confidence === null || isFiniteNumber(value.confidence))
  );
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

// How much of the screen bottom the keyboard is currently covering.
//
// KeyboardAvoidingView measures its own frame relative to its parent, so inside the
// absolutely-positioned sheet layer it computes an offset of zero and lets the keyboard
// sit on top of the sheet's buttons. Track the keyboard directly instead — the same
// approach ConversationThread already uses for its input row.
function useKeyboardOverlap() {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Sheets sit inside the app SafeAreaView, whose bottom inset already lifts them above
  // the home indicator; subtract it so that gap isn't counted twice.
  return keyboardHeight > 0 ? Math.max(0, keyboardHeight - insets.bottom) : 0;
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
  const body = readerParagraphs
    .map((paragraph, index) => {
      const pageIndex = paragraph.sourceRef?.pageIndex;
      const previousPageIndex = readerParagraphs[index - 1]?.sourceRef?.pageIndex;
      const pageMarker =
        paragraph.sourceRef?.source === 'pdf' && typeof pageIndex === 'number' && pageIndex !== previousPageIndex
          ? `<div class="reader-page-marker">${escapeHtml(
              paragraph.sourceRef.pageLabel || `Page ${pageIndex + 1}`,
            )}</div>`
          : '';

      return `${pageMarker}${renderReaderBlockHtml(paragraph)}`;
    })
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
        font-size: 17px;
        line-height: 1.55;
        padding: 18px 28px 146px;
        position: relative;
        -webkit-touch-callout: none;
        -webkit-user-select: text;
        user-select: text;
      }

      .reader-block {
        color: #171715;
        font-family: Georgia, 'Times New Roman', serif;
        letter-spacing: 0;
        position: relative;
        z-index: 1;
        -webkit-touch-callout: none;
        -webkit-user-select: text;
        user-select: text;
        /* Let WebKit skip layout/paint for off-screen blocks. Keeps the full
           DOM intact (selection, getElementById scroll targets still work) but
           prevents the content process from being killed under memory pressure
           on long books. contain-intrinsic-size gives off-screen blocks an
           estimated height so the scrollbar and scroll position stay stable. */
        content-visibility: auto;
        contain-intrinsic-size: auto 60px;
      }

      .reader-page-marker {
        border-top: 1px solid #ddd8cf;
        color: #78746d;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0;
        margin: 32px 0 24px;
        padding-top: 10px;
        text-align: right;
      }

      .reader-page-marker:first-child {
        border-top: 0;
        margin-top: 0;
        padding-top: 0;
      }

      .reader-citation-flash {
        animation: readerCitationFlash 2.6s ease-out forwards;
        border-radius: 4px;
      }

      @keyframes readerCitationFlash {
        0% { background-color: #fbe7a2; }
        70% { background-color: #fbe7a2; }
        100% { background-color: transparent; }
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

      .reader-selection-overlay {
        background: rgba(207, 222, 200, 0.82);
        border-radius: 3px;
        pointer-events: none;
        position: absolute;
        z-index: 0;
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
        var locationTimer;
        var isFreezingSelection = false;
        var isTouchSelecting = false;
        var lastPendingText = '';

        function postMessage(message) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }

        function clearFrozenSelection() {
          var overlays = Array.prototype.slice.call(document.querySelectorAll('.reader-selection-overlay'));
          overlays.forEach(function (overlay) {
            overlay.remove();
          });
        }

        function freezeSelection(range, selection) {
          clearFrozenSelection();

          var rects = Array.prototype.slice.call(range.getClientRects()).filter(function (rect) {
            return rect.width > 1 && rect.height > 1;
          });

          rects.forEach(function (rect) {
            var overlay = document.createElement('span');
            overlay.className = 'reader-selection-overlay';
            overlay.style.left = (rect.left + window.scrollX) + 'px';
            overlay.style.top = (rect.top + window.scrollY) + 'px';
            overlay.style.width = rect.width + 'px';
            overlay.style.height = rect.height + 'px';
            document.body.appendChild(overlay);
          });

          isFreezingSelection = true;
          selection.removeAllRanges();
          setTimeout(function () {
            isFreezingSelection = false;
          }, 0);
        }

        function postSelectionPending(force) {
          if (isFreezingSelection) {
            return;
          }

          clearFrozenSelection();
          var selection = window.getSelection();
          var text = selection ? normalize(selection.toString()) : '';

          if (text && (force || text !== lastPendingText)) {
            lastPendingText = text;
            postMessage({ type: 'selectionPending' });
          }
        }

        function postSelection() {
          var selection = window.getSelection();

          if (!selection || selection.rangeCount === 0) {
            return;
          }

          var text = normalize(selection.toString());

          if (!text) {
            lastPendingText = '';
            clearFrozenSelection();
            postMessage({ type: 'clearSelection' });
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
          lastPendingText = text;
          freezeSelection(range, selection);
        }

        function postVisibleLocation() {
          var blocks = Array.prototype.slice.call(document.querySelectorAll('[data-paragraph-id]'));
          var viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0;
          var visibleBlocks = blocks.filter(function (block) {
            var rect = block.getBoundingClientRect();
            return rect.bottom > 24 && rect.top < viewportBottom - 96;
          });
          var visibleBlock = visibleBlocks[0] || blocks.find(function (block) {
            return block.getBoundingClientRect().bottom > 24;
          });
          var visibleParagraphIds = visibleBlocks.map(function (block) {
            return block.dataset.paragraphId;
          }).filter(Boolean);

          if (visibleBlock && visibleBlock.dataset && visibleBlock.dataset.paragraphId) {
            postMessage({
              type: 'location',
              paragraphId: visibleBlock.dataset.paragraphId,
              visibleParagraphIds: visibleParagraphIds.length ? visibleParagraphIds : [visibleBlock.dataset.paragraphId]
            });
          }
        }

        function schedulePostVisibleLocation() {
          clearTimeout(locationTimer);
          locationTimer = setTimeout(postVisibleLocation, 140);
        }

        function schedulePostSelection(delay) {
          clearTimeout(timer);
          timer = setTimeout(function () {
            postSelection();
          }, delay);
        }

        document.addEventListener('selectionchange', function () {
          if (isFreezingSelection) {
            return;
          }

          postSelectionPending();
          schedulePostSelection(isTouchSelecting ? 520 : 100);
        });
        document.addEventListener('mouseup', function () {
          schedulePostSelection(60);
        });
        document.addEventListener('touchstart', function () {
          isTouchSelecting = true;
          postSelectionPending(true);
        }, { passive: true });
        document.addEventListener('touchcancel', function () {
          isTouchSelecting = false;
          schedulePostSelection(80);
        });
        document.addEventListener('touchend', function () {
          isTouchSelecting = false;
          schedulePostSelection(40);
        });
        document.addEventListener('scroll', schedulePostVisibleLocation, { passive: true });
        document.addEventListener('touchstart', function (event) {
          if (!event.target || !event.target.closest || !event.target.closest('.reader-selection-overlay')) {
            return;
          }

          clearFrozenSelection();
          postMessage({ type: 'clearSelection' });
        }, { passive: true });
        window.addEventListener('load', postVisibleLocation);
        setTimeout(postVisibleLocation, 240);
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

function ReaderApp() {
  const {
    error: authError,
    getAccessToken,
    isAuthenticated,
    isLoading: isAuthLoading,
    sessionExpired,
    dismissSessionExpiredNotice,
    signIn,
    signOut,
  } = useAuth();
  const [pendingAuthenticatedAction, setPendingAuthenticatedAction] = useState<'import' | 'scan' | null>(null);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([sampleLibraryItem]);
  const [activeBookId, setActiveBookId] = useState(sampleLibraryItem.id);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [contextSelection, setContextSelection] = useState<ReaderSelection | null>(null);
  const [isSelectionSettling, setIsSelectionSettling] = useState(false);
  const [selectedAction, setSelectedAction] = useState<InsightAction | null>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [isImportingBook, setIsImportingBook] = useState(false);
  const [scanStage, setScanStage] = useState<ScanStage>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isSavedNotesOpen, setIsSavedNotesOpen] = useState(false);
  const [isWholeBookAiOpen, setIsWholeBookAiOpen] = useState(false);
  // Read inside runIndexBookFor's async resolution to decide whether the sheet is
  // currently showing this exact book's result live (skip the notice if so) — refs
  // avoid stale closures, since the indexing promise can resolve long after the user
  // has navigated to a different book or closed the sheet.
  const isWholeBookAiOpenRef = useRef(isWholeBookAiOpen);
  isWholeBookAiOpenRef.current = isWholeBookAiOpen;
  const activeBookIdRef = useRef(activeBookId);
  activeBookIdRef.current = activeBookId;
  // Tracks library item ids with an in-flight runIndexBookFor call, so the
  // background resume-check can't start a second concurrent upload/index run for
  // a book the user (or an earlier resume-check tick) already has running.
  const inFlightIndexingRef = useRef<Set<string>>(new Set());
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [isAssistLoading, setIsAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<{ questionText: string; ctx?: { quotedText: string; quotedTurnId?: string } } | null>(null);
  const [copiedSelectionId, setCopiedSelectionId] = useState<string | null>(null);
  const [highlightedSelectionId, setHighlightedSelectionId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [bookAskSources, setBookAskSources] = useState<BookSource[]>([]);
  const [isThreadOpen, setIsThreadOpen] = useState(false);
  const [isThreadCollapsed, setIsThreadCollapsed] = useState(false);
  const [includeWholeBook, setIncludeWholeBook] = useState(false);
  const [askContextScope, setAskContextScope] = useState<AskContextScope>('selection');
  const [lastAskRequest, setLastAskRequest] = useState<LastAskRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('book');
  const [visibleParagraphIds, setVisibleParagraphIds] = useState<string[]>([]);
  const [noteSearchQuery, setNoteSearchQuery] = useState('');
  const [editingNote, setEditingNote] = useState<SavedInsight | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [editingNoteQuestion, setEditingNoteQuestion] = useState('');
  // The editor is reused for two different moments: right after a note is first saved
  // (it's already persisted - this sheet is just an optional "add anything?" step) and
  // reopening an existing note later to genuinely edit it. Only the latter has anything
  // to cancel, so the sheet's dismiss button needs to say something different depending
  // on which one this is - see SavedNoteEditorSheet's closeLabel.
  const [editingNoteJustCreated, setEditingNoteJustCreated] = useState(false);
  const [notesCopyFeedback, setNotesCopyFeedback] = useState(false);
  const [notesExportPending, setNotesExportPending] = useState(false);
  // Mind map state
  const [mindMapOpen, setMindMapOpen] = useState(false);
  const [mindMapBookId, setMindMapBookId] = useState<string | null>(null);
  const [mindMapBookTitle, setMindMapBookTitle] = useState<string>('');
  const [mindMapStatus, setMindMapStatus] = useState<MindMapStatus>('pending');
  const [mindMapData, setMindMapData] = useState<MindMapData | null>(null);
  const [mindMapError, setMindMapError] = useState<string | undefined>(undefined);
  // Tracks library item ids with an in-flight pollMindMapUntilDone loop, so
  // reopening a still-generating book's screen (or a resume-check tick) can't
  // start a second overlapping poll loop for the same book.
  const mindMapInFlightRef = useRef<Set<string>>(new Set());
  // Navigation state lifted so it survives close/reopen for the same book.
  const [mindMapNavTab, setMindMapNavTab] = useState<'concepts' | 'chapters'>('concepts');
  const [mindMapNavOpenChapterId, setMindMapNavOpenChapterId] = useState<string | null>(null);
  // Selection + zoom state restored when the map reopens for the same book.
  const [mindMapSavedNodeId, setMindMapSavedNodeId] = useState<string | null>(null);
  const [mindMapSavedChapterId, setMindMapSavedChapterId] = useState<string | null>(null);
  const [mindMapSavedZooms, setMindMapSavedZooms] = useState<Record<string, { zoom: number; offsetX: number; offsetY: number }>>({});
  // Written synchronously by MindMapScreen on every render so closeMindMap() can
  // capture the live state (including selection that hasn't been cleared yet).
  const mindMapLiveRef = useRef<import('./src/components/MindMapScreen').MindMapLiveState>({
    selectedNodeId: null,
    selectedChapterId: null,
    zoomStates: {},
  });
  // Set when the user jumps to a passage from the mind map; drives the "← Map" return chip.
  const [mindMapReturnBookId, setMindMapReturnBookId] = useState<string | null>(null);
  // A quick-ask question queued from a mind-map tap sheet. Fired once the target book
  // becomes active (book switch + conversation state are tied to activeBookId).
  const [pendingQuickAsk, setPendingQuickAsk] = useState<{ bookId: string; question: string; allowGeneralKnowledge: boolean } | null>(null);
  // Set when the mind map is tapped for a book that isn't ready yet; drives the
  // WholeBookAiSheet redirect and the auto-continue effect below.
  const [pendingMindMapAfterEnable, setPendingMindMapAfterEnable] = useState<{ bookId: string; bookTitle: string } | null>(null);

  const assistRequestId = useRef(0);
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesCopyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScanningDocument = scanStage !== 'idle';
  const scanStageLabel = getScanStageLabel(scanStage);
  const activeLibraryItem = useMemo(
    () => getActiveLibraryItem(libraryItems, activeBookId),
    [activeBookId, libraryItems],
  );
  const pendingNotice = selectPendingNotice(libraryItems);

  // wholeBookAi.status is a per-book flag persisted locally — it stays 'ready' after
  // the indexing that set it, even across a later sign-out. Signing out doesn't reset
  // it (correctly — re-signing in with the same account shouldn't require re-indexing),
  // so any check that opens Whole-Book-AI-gated UI must also confirm there's still a
  // live session, or a signed-out user sees the Ask thread/mind map open as if nothing
  // changed.
  function canUseWholeBookAi(item: LibraryItem) {
    return item.wholeBookAi.status === 'ready' && isAuthenticated;
  }

  function clearPendingNoticeOfKind(bookId: string, kind: 'indexing' | 'mindmap') {
    setLibraryItems((items) =>
      items.map((item) =>
        item.id === bookId && item.pendingNotice?.kind === kind
          ? { ...item, pendingNotice: undefined }
          : item,
      ),
    );
  }
  const currentBook = activeLibraryItem.book;
  const readingLocation = activeLibraryItem.readingLocation;
  const savedInsights = activeLibraryItem.savedInsights;
  const readerHtml = useMemo(() => createReaderHtml(currentBook.paragraphs), [currentBook.paragraphs]);

  const savedChatTurnIds = useMemo(
    () =>
      new Set(
        savedInsights
          .filter((note) => note.id.startsWith(chatInsightIdPrefix))
          .map((note) => note.id.slice(chatInsightIdPrefix.length)),
      ),
    [savedInsights],
  );
  const activeInsightSelection = selection ?? contextSelection;
  const isSaved =
    activeInsightSelection && selectedAction && insight
      ? savedInsights.some((savedInsight) =>
          isSavedInsightMatch(savedInsight, activeInsightSelection, selectedAction, insight),
        )
      : false;
  const readerProgress = useMemo(
    () => getReaderProgress(currentBook, readingLocation),
    [currentBook, readingLocation],
  );
  const searchResults = useMemo(
    () => getSearchResults(currentBook, savedInsights, searchQuery, searchScope),
    [currentBook, savedInsights, searchQuery, searchScope],
  );

  useEffect(() => {
    setVisibleParagraphIds(
      readingLocation
        ? normalizeVisibleParagraphIds([readingLocation.paragraphId], currentBook.paragraphs, readingLocation.paragraphId)
        : [],
    );
  }, [activeBookId]);

  function updateActiveLibraryItem(updater: (item: LibraryItem) => LibraryItem) {
    setLibraryItems((currentItems) =>
      currentItems.map((item) => (item.id === activeBookId ? updater(item) : item)),
    );
  }

  function clearSelection() {
    assistRequestId.current += 1;
    setSelection(null);
    setContextSelection(null);
    setIsSelectionSettling(false);
    setSelectedAction(null);
    setInsight(null);
    setAssistError(null);
    setIsAssistLoading(false);
    setCopiedSelectionId(null);
    setIsAskOpen(false);
    setIsSavedNotesOpen(false);
    setEditingNote(null);
    setEditingNoteText('');
    setQuestion('');
    setBookAskSources([]);
    setIncludeWholeBook(false);
    setAskContextScope('selection');
    setLastAskRequest(null);
  }

  // Clears only the context chip in the conversation thread without resetting
  // the loading state or cancelling an in-flight request.
  function clearContextChip() {
    setSelection(null);
    setContextSelection(null);
  }

  function openLibrary() {
    clearSelection();
    setIsTocOpen(false);
    setIsSavedNotesOpen(false);
    setIsAskOpen(false);
    setIsSearchOpen(false);
    setIsLibraryOpen(true);
  }

  function openLibraryItem(bookId: string) {
    const libraryItem = libraryItems.find((item) => item.id === bookId);

    if (!libraryItem) {
      return;
    }

    clearSelection();
    setIsThreadOpen(false);
    setIsThreadCollapsed(false);
    setIsTocOpen(false);
    setIsSavedNotesOpen(false);
    setIsAskOpen(false);
    setIsSearchOpen(false);
    setImportError(null);
    setActiveBookId(bookId);
    setLibraryItems((currentItems) =>
      currentItems.map((item) =>
        item.id === bookId ? { ...item, lastOpenedAt: new Date().toISOString() } : item,
      ),
    );
    setIsLibraryOpen(false);

    if (libraryItem.readingLocation) {
      setScrollTarget({
        nonce: Date.now(),
        paragraphId: libraryItem.readingLocation.paragraphId,
      });
    }
  }

  async function deleteLibraryItem(bookId: string) {
    const itemToDelete = libraryItems.find((item) => item.id === bookId);

    if (!itemToDelete || itemToDelete.book.source === 'sample' || libraryItems.length <= 1) {
      return;
    }

    const cloudBookId = itemToDelete.wholeBookAi?.cloudBookId;
    if (cloudBookId) {
      // Removing the cloud index requires a valid session. Acquire the token
      // before the optimistic 'deleting' flicker: if the user is signed out,
      // prompt sign-in instead of silently reverting with no explanation — they
      // can retry the delete after signing back in. (A book can only have a
      // cloudBookId if it was indexed while signed in, so the sign-in sheet is
      // always the right response to a missing token here.)
      const token = await getAccessToken();
      if (!token) {
        setIsSignInOpen(true);
        return;
      }

      setLibraryItems((items) =>
        items.map((item) =>
          item.id === bookId
            ? { ...item, wholeBookAi: { ...item.wholeBookAi, status: 'deleting' } }
            : item,
        ),
      );

      let ok = false;
      try {
        const resp = await fetch(`${apiBaseUrl}/library/books/${cloudBookId}/index`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        ok = resp.ok || resp.status === 404;
      } catch {
        ok = false;
      }

      if (!ok) {
        // Revert to previous state so the user can retry (covers a mid-request
        // network failure or the token lapsing between request and response).
        setLibraryItems((items) =>
          items.map((item) =>
            item.id === bookId
              ? { ...item, wholeBookAi: itemToDelete.wholeBookAi }
              : item,
          ),
        );
        return;
      }
    }

    const remainingItems = libraryItems.filter((item) => item.id !== bookId);
    const nextActiveItem =
      activeBookId === bookId ? remainingItems[0] ?? sampleLibraryItem : getActiveLibraryItem(remainingItems, activeBookId);

    clearSelection();
    setLibraryItems(remainingItems);
    setActiveBookId(nextActiveItem.id);

    if (activeBookId === bookId && nextActiveItem.readingLocation) {
      setScrollTarget({
        nonce: Date.now(),
        paragraphId: nextActiveItem.readingLocation.paragraphId,
      });
    }
  }

  function jumpToChapter(chapter: ReaderChapter) {
    clearSelection();
    setVisibleParagraphIds([chapter.paragraphId]);
    updateReadingLocation(chapter.paragraphId);
    setScrollTarget({
      nonce: Date.now(),
      paragraphId: chapter.paragraphId,
    });
    setIsTocOpen(false);
  }

  function openSearch() {
    clearSelection();
    setIsTocOpen(false);
    setIsSavedNotesOpen(false);
    setIsSearchOpen(true);
  }

  function jumpToSearchResult(result: SearchResult) {
    if (result.kind === 'note' && result.noteId) {
      const savedInsight = savedInsights.find((note) => note.id === result.noteId);

      if (savedInsight) {
        setIsSearchOpen(false);
        openSavedInsight(savedInsight);
      }

      return;
    }

    clearSelection();
    setVisibleParagraphIds([result.paragraphId]);
    updateReadingLocation(result.paragraphId);
    setScrollTarget({
      nonce: Date.now(),
      paragraphId: result.paragraphId,
    });
    setIsSearchOpen(false);
  }

  function setSelectionFromReader(text: string, paragraphId: string, selectionKind: SelectionKind) {
    const normalizedText = normalizeSelectionText(text);
    const knownSegment = findKnownSegmentForSelection(normalizedText, currentBook.paragraphs);

    if (!normalizedText) {
      clearSelection();
      return;
    }

    assistRequestId.current += 1;
    updateReadingLocation(knownSegment?.paragraphId ?? paragraphId);
    setIsSelectionSettling(false);
    setSelection({
      id: knownSegment?.id ?? `selection:${paragraphId}:${normalizedText}`,
      paragraphId: knownSegment?.paragraphId ?? paragraphId,
      selectionKind: knownSegment?.selectionKind ?? selectionKind,
      text: normalizedText,
    });
    setContextSelection(null);
    setSelectedAction(null);
    setInsight(null);
    setAssistError(null);
    setIsAssistLoading(false);
    setCopiedSelectionId(null);
    setIsAskOpen(false);
    setAskContextScope('selection');
    setLastAskRequest(null);
    setIsSavedNotesOpen(false);
  }

  function handleReaderMessage(message: ReaderMessage) {
    if (message.type === 'selectionPending') {
      setIsSelectionSettling(true);
      return;
    }

    if (message.type === 'clearSelection') {
      clearSelection();
      return;
    }

    if (message.type === 'location') {
      const nextVisibleParagraphIds = normalizeVisibleParagraphIds(
        message.visibleParagraphIds,
        currentBook.paragraphs,
        message.paragraphId,
      );
      const didReachScrollTarget =
        !scrollTarget ||
        message.paragraphId === scrollTarget.paragraphId ||
        nextVisibleParagraphIds.includes(scrollTarget.paragraphId);

      if (!didReachScrollTarget) {
        return;
      }

      setVisibleParagraphIds(nextVisibleParagraphIds);
      updateReadingLocation(scrollTarget?.paragraphId ?? message.paragraphId);

      if (scrollTarget) {
        setScrollTarget(null);
      }

      return;
    }

    setSelectionFromReader(message.text, message.paragraphId, message.selectionKind);
  }

  function updateReadingLocation(paragraphId: string) {
    if (!getParagraphById(paragraphId, currentBook.paragraphs)) {
      return;
    }

    const sourceRef = getParagraphSourceRef(paragraphId, currentBook);

    updateActiveLibraryItem((item) => {
      if (item.readingLocation?.paragraphId === paragraphId && item.readingLocation.sourceRef) {
        return item;
      }

      return {
        ...item,
        lastOpenedAt: new Date().toISOString(),
        readingLocation: { paragraphId, sourceRef },
      };
    });
  }

  function openSavedInsight(savedInsight: SavedInsight) {
    if (savedInsight.action === 'highlight') {
      setIsSavedNotesOpen(false);
      setIsTocOpen(false);
      setIsAskOpen(false);
      updateReadingLocation(savedInsight.paragraphId);
      setScrollTarget({
        nonce: Date.now(),
        paragraphId: savedInsight.paragraphId,
        excerpt: savedInsight.selectedText,
      });
      return;
    }

    const restoredSelection = {
      id: `selection:${savedInsight.paragraphId}:${savedInsight.selectedText}`,
      contextScope: savedInsight.action === 'summarize' ? ('visiblePage' as AssistContextScope) : undefined,
      paragraphId: savedInsight.paragraphId,
      selectionKind: savedInsight.selectionKind,
      text: savedInsight.selectedText,
      visibleParagraphIds: savedInsight.action === 'summarize' ? [savedInsight.paragraphId] : undefined,
    };

    assistRequestId.current += 1;
    setIsSavedNotesOpen(false);
    setIsTocOpen(false);
    setIsAskOpen(false);
    setSelection(savedInsight.action === 'summarize' ? null : restoredSelection);
    setContextSelection(savedInsight.action === 'summarize' ? restoredSelection : null);
    setSelectedAction(savedInsight.action);
    setInsight({
      body: savedInsight.body,
      // A thread note's title is its question, and its `eyebrow` is empty (or, for a note
      // saved before the question field existed, holds the question). Same headline the
      // saved-notes list and the editor use, so the reopened card can't disagree with them.
      eyebrow: getSavedNoteHeadline(savedInsight),
    });
    setAssistError(null);
    setIsAssistLoading(false);
    setCopiedSelectionId(null);
    setAskContextScope(savedInsight.action === 'summarize' ? 'visiblePage' : 'selection');
    setLastAskRequest(null);
    updateReadingLocation(savedInsight.paragraphId);
    setScrollTarget({
      nonce: Date.now(),
      paragraphId: savedInsight.paragraphId,
    });
  }

  useEffect(() => {
    return () => {
      if (copyFeedbackTimer.current) {
        clearTimeout(copyFeedbackTimer.current);
      }

      if (highlightFeedbackTimer.current) {
        clearTimeout(highlightFeedbackTimer.current);
      }

      if (notesCopyFeedbackTimer.current) {
        clearTimeout(notesCopyFeedbackTimer.current);
      }
    };
  }, []);

  // When isAuthenticated transitions to true, dispatch any pending action.
  // This avoids the stale-closure race where importBook()/scanDocumentPage()
  // see isAuthenticated=false immediately after signIn() resolves.
  useEffect(() => {
    if (!isAuthenticated || !pendingAuthenticatedAction) {
      return;
    }

    const action = pendingAuthenticatedAction;
    setPendingAuthenticatedAction(null);
    setIsSignInOpen(false);

    if (action === 'import') {
      void importBook();
    } else if (action === 'scan') {
      void scanDocumentPage();
    }
  // importBook and scanDocumentPage are stable (defined inside component, not recreated)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    let isCancelled = false;

    async function restoreReaderState() {
      try {
        const persistedState = await readPersistedReaderState();

        if (!persistedState || isCancelled) {
          return;
        }

        const restoredItem = getActiveLibraryItem(persistedState.libraryItems, persistedState.activeBookId);
        const restoredLocation =
          restoredItem.readingLocation &&
          getParagraphById(restoredItem.readingLocation.paragraphId, restoredItem.book.paragraphs)
            ? restoredItem.readingLocation
            : getInitialReadingLocation(restoredItem.book);

        setLibraryItems(persistedState.libraryItems);
        setActiveBookId(restoredItem.id);

        if (restoredLocation) {
          setScrollTarget({
            nonce: Date.now(),
            paragraphId: restoredLocation.paragraphId,
          });
        }
      } catch (error) {
        if (!isCancelled) {
          setImportError(`Could not restore saved reader state. ${getErrorMessage(error)}`);
        }
      } finally {
        if (!isCancelled) {
          setIsStorageReady(true);
        }
      }
    }

    void restoreReaderState();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isStorageReady) {
      return undefined;
    }

    const persistTimer = setTimeout(() => {
      void writePersistedReaderState({
        activeBookId,
        libraryItems,
        schemaVersion: LIBRARY_SCHEMA_VERSION,
      }).catch((error) => {
        setImportError(`Could not save reader state. ${getErrorMessage(error)}`);
      });
    }, 650);

    return () => {
      clearTimeout(persistTimer);
    };
  }, [activeBookId, isStorageReady, libraryItems]);

  // Fire a quick-ask queued from the mind map once its book is the active book.
  // openMindMap can launch from the library list, so the book switch may land a
  // render after the chip was tapped — wait for activeBookId to catch up.
  useEffect(() => {
    if (!pendingQuickAsk) {
      return;
    }
    if (activeBookId !== pendingQuickAsk.bookId) {
      return;
    }
    const { question, allowGeneralKnowledge } = pendingQuickAsk;
    setPendingQuickAsk(null);
    if (!canUseWholeBookAi(activeLibraryItem)) {
      // Shouldn't happen while still signed in — the mind map can't render without
      // Whole-Book AI — but fail safe by prompting to enable/sign in rather than
      // silently dropping the ask.
      setIsWholeBookAiOpen(true);
      return;
    }
    setAssistError(null);
    setIsAskOpen(false);
    setIsThreadCollapsed(false);
    setIsThreadOpen(true);
    void runBookAsk(question, undefined, { allowGeneralKnowledge });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuickAsk, activeBookId, activeLibraryItem]);

  // Continue into mind map generation once Whole-Book AI finishes enabling, when
  // the enable flow was triggered by tapping the mind map itself (not the Ask flow).
  useEffect(() => {
    if (!pendingMindMapAfterEnable) {
      return;
    }
    if (activeBookId !== pendingMindMapAfterEnable.bookId) {
      return;
    }
    if (activeLibraryItem.wholeBookAi.status !== 'ready') {
      return;
    }
    const { bookId, bookTitle } = pendingMindMapAfterEnable;
    setPendingMindMapAfterEnable(null);
    setIsWholeBookAiOpen(false);
    void openMindMap(bookId, bookTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMindMapAfterEnable, activeBookId, activeLibraryItem]);

  // Mirrors libraryItems/mindMapOpen/mindMapBookId so checkBackgroundJobs and its
  // "is this book being watched live" check always read current values, without
  // needing them in the effect's dependency array below — that would tear down and
  // re-subscribe the AppState listener far more often than a launch/foreground tick.
  const libraryItemsRef = useRef(libraryItems);
  libraryItemsRef.current = libraryItems;
  const mindMapOpenRef = useRef(mindMapOpen);
  mindMapOpenRef.current = mindMapOpen;
  const mindMapBookIdRef = useRef(mindMapBookId);
  mindMapBookIdRef.current = mindMapBookId;

  async function checkBackgroundJobs() {
    const token = await getAccessToken();
    if (!token) {
      return;
    }
    for (const item of libraryItemsRef.current) {
      if (
        item.wholeBookAi.status === 'uploading' ||
        item.wholeBookAi.status === 'queued' ||
        item.wholeBookAi.status === 'indexing'
      ) {
        void runIndexBookFor(item, { silent: true });
      }

      if (item.mindMapJob?.status === 'generating' && item.wholeBookAi.cloudBookId) {
        void pollMindMapUntilDone(item.id, item.wholeBookAi.cloudBookId);
      }
    }
  }

  useEffect(() => {
    // Also wait on isStorageReady: libraryItems starts as a single placeholder
    // sample book and only becomes the real restored library once the separate,
    // independently-timed restoreReaderState effect finishes. Firing on
    // isAuthLoading alone risks running checkBackgroundJobs against that stale
    // placeholder list on a cold launch, silently skipping every real book — and
    // since this effect only reruns on isAuthLoading changes or an AppState
    // 'active' transition, a missed initial check has no other chance to fire
    // until the user backgrounds/foregrounds again.
    if (isAuthLoading || !isStorageReady) {
      return;
    }
    void checkBackgroundJobs();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void checkBackgroundJobs();
      }
    });
    return () => {
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, isStorageReady]);

  // Opening the sheet for a book with an unseen indexing notice implicitly shows
  // the result live — clear the notice so the banner doesn't also appear for it.
  useEffect(() => {
    if (!isWholeBookAiOpen) {
      return;
    }
    clearPendingNoticeOfKind(activeBookId, 'indexing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWholeBookAiOpen, activeBookId]);

  // Same idea for the mind map screen.
  useEffect(() => {
    if (!mindMapOpen || !mindMapBookId) {
      return;
    }
    clearPendingNoticeOfKind(mindMapBookId, 'mindmap');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mindMapOpen, mindMapBookId]);

  function chooseAction(action: SelectionAction) {
    if (action === 'copy') {
      void copySelectionToClipboard();
      return;
    }

    if (action === 'highlight') {
      saveHighlight();
      return;
    }

    if (action === 'ask') {
      assistRequestId.current += 1;
      setLastAskRequest(null);
      setSelectedAction('ask');
      setInsight(null);
      setAssistError(null);
      setIsAssistLoading(false);
      setIsSavedNotesOpen(false);
      if (!canUseWholeBookAi(activeLibraryItem)) {
        setIsWholeBookAiOpen(true);
        return;
      }
      setIsAskOpen(false);
      setIsThreadCollapsed(false);
      setIsThreadOpen(true);
      return;
    }

    setLastAskRequest(null);
    setContextSelection(null);
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

  function saveHighlight() {
    if (!selection) {
      return;
    }

    const highlightedSelection = selection;
    const highlightedId = highlightedSelection.id;
    const alreadyHighlighted = savedInsights.some((note) => isHighlightMatch(note, highlightedSelection));

    if (!alreadyHighlighted) {
      updateActiveLibraryItem((item) => ({
        ...item,
        lastOpenedAt: new Date().toISOString(),
        savedInsights: [
          ...item.savedInsights,
          {
            action: 'highlight',
            body: '',
            bookTitle: currentBook.title,
            createdAt: new Date().toISOString(),
            eyebrow: '',
            id: createHighlightId(highlightedSelection),
            paragraphId: highlightedSelection.paragraphId,
            selectedText: highlightedSelection.text,
            selectionKind: highlightedSelection.selectionKind,
            sourceRef: getParagraphSourceRef(highlightedSelection.paragraphId, currentBook),
          },
        ],
      }));
    }

    setHighlightedSelectionId(highlightedId);

    if (highlightFeedbackTimer.current) {
      clearTimeout(highlightFeedbackTimer.current);
    }

    highlightFeedbackTimer.current = setTimeout(() => {
      setHighlightedSelectionId((currentId) => (currentId === highlightedId ? null : currentId));
    }, 1400);
  }

  function saveChatTurn(turn: ConversationTurn) {
    // The follow-up input's keyboard has no reason to stay open once the reader has
    // moved on to saving a note - left alone, it stays up and covers the bottom of the
    // Edit note sheet this function is about to open.
    Keyboard.dismiss();

    const insightId = createChatInsightId(turn);

    if (savedInsights.some((note) => note.id === insightId)) {
      return;
    }

    const askedTurn = findPrecedingUserTurn(activeLibraryItem.conversation, turn);
    // The ask API sends absent optional fields as JSON `null`, not as omitted keys — an
    // EPUB answer has no pageIndex, so that is the normal shape, not an edge case. `null`
    // survives JSON.stringify where `undefined` is dropped, and a persisted `null` fails
    // isSavedCitation on the next launch. Normalize here, at the boundary, then keep only
    // citations that actually validate so nothing unparseable is ever written.
    const citations: SavedCitation[] = (turn.sources ?? [])
      .slice(0, 3)
      .map((source) => ({
        chapterTitle: source.chapterTitle ?? undefined,
        excerpt: source.excerpt,
        pageIndex: source.pageIndex ?? undefined,
        pageLabel: source.pageLabel ?? undefined,
        paragraphId: source.paragraphId,
        sourceRef: source.sourceRef,
      }))
      .filter(isSavedCitation);
    // Only a passage the reader actually selected earns this field. A citation is what
    // the retriever looked at, not what the reader pointed to, so it stays in
    // `citations` where it can't masquerade as a selection.
    const selectedText = askedTurn?.selectedText ?? '';
    const paragraphId =
      askedTurn?.contextParagraphId ?? citations[0]?.paragraphId ?? readingLocation?.paragraphId ?? '';
    const savedAt = new Date().toISOString();
    const note: SavedInsight = {
      action: 'ask',
      body: turn.text,
      bookTitle: currentBook.title,
      citations: citations.length > 0 ? citations : undefined,
      createdAt: savedAt,
      eyebrow: '',
      id: insightId,
      paragraphId,
      question: composeNoteQuestion(activeLibraryItem.conversation, turn),
      selectedText,
      selectionKind: 'paragraph',
      sourceRef: citations[0]?.sourceRef ?? getParagraphSourceRef(paragraphId, currentBook),
    };

    updateActiveLibraryItem((item) => ({
      ...item,
      lastOpenedAt: savedAt,
      savedInsights: [...item.savedInsights, note],
    }));
    // Open the editor on the new note so the reader can correct a composed question and
    // add their own thought while it's fresh. `editingNote` renders last in the sheet
    // stack, so it lands above the open thread; closing it returns to the conversation.
    startEditingSavedInsight(note, { justCreated: true });
  }

  async function importBook() {
    if (!isAuthenticated) {
      setPendingAuthenticatedAction('import');
      setIsSignInOpen(true);
      return;
    }

    setImportError(null);
    setIsImportingBook(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/epub+zip', 'application/pdf', 'application/octet-stream', '*/*'],
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];

      if (!asset) {
        throw new Error('No file was selected.');
      }

      if (!isSupportedEpubAsset(asset) && !isSupportedPdfAsset(asset)) {
        throw new Error(getUnsupportedImportMessage(asset));
      }

      const importedBook = isSupportedPdfAsset(asset)
        ? toPdfReaderBook(await requestApplePdfImport(asset.uri), asset)
        : toReaderBook(await parseEpubAsset(asset));
      const importedItem = createLibraryItem(importedBook);
      clearSelection();
      setLibraryItems((currentItems) => [importedItem, ...currentItems]);
      setActiveBookId(importedItem.id);
      setIsLibraryOpen(false);

      if (importedItem.readingLocation) {
        setScrollTarget({
          nonce: Date.now(),
          paragraphId: importedItem.readingLocation.paragraphId,
        });
      }
    } catch (error) {
      setImportError(getErrorMessage(error));
    } finally {
      setIsImportingBook(false);
    }
  }

  async function scanDocumentPage() {
    if (!isAuthenticated) {
      setPendingAuthenticatedAction('scan');
      setIsSignInOpen(true);
      return;
    }

    setImportError(null);
    setScanStage('capturing');

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        throw new Error('Camera permission is required to scan a page.');
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        base64: false,
        cameraType: ImagePicker.CameraType.back,
        exif: false,
        mediaTypes: ['images'],
        quality: 1,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];

      if (!asset) {
        throw new Error('No camera image was captured.');
      }

      const preparationStartedAt = Date.now();
      setScanStage('reading');
      let ocrResult = await requestAppleVisionOcr(asset.uri);

      if (!ocrResult) {
        setScanStage('preparing');
        const preparedImage = await prepareOcrImage(asset);
        console.info('[OCR] image prepared', {
          height: preparedImage.height,
          payloadKb: Math.round(preparedImage.payloadBytes / 1024),
          preparationMs: Date.now() - preparationStartedAt,
          width: preparedImage.width,
        });
        setScanStage('uploading');
        const ocrToken = await getAccessToken();
        if (!ocrToken) {
          setIsSignInOpen(true);
          throw new Error('Your sign-in has expired. Please sign in again to scan a page.');
        }
        ocrResult = await requestOcr({ imageDataUrl: preparedImage.dataUrl }, ocrToken);
      }

      const scannedBook = toScanReaderBook(ocrResult, asset);

      if (scannedBook.paragraphs.length === 0) {
        throw new Error('No readable text was found in that image. Try a flatter, brighter capture.');
      }

      const scannedItem = createLibraryItem(scannedBook);
      clearSelection();
      setLibraryItems((currentItems) => [scannedItem, ...currentItems]);
      setActiveBookId(scannedItem.id);
      setIsLibraryOpen(false);

      if (scannedItem.readingLocation) {
        setScrollTarget({
          nonce: Date.now(),
          paragraphId: scannedItem.readingLocation.paragraphId,
        });
      }
    } catch (error) {
      setImportError(getErrorMessage(error));
    } finally {
      setScanStage('idle');
    }
  }

  async function summarizeVisiblePage() {
    const summarySelection = createSummarySelection(currentBook, readingLocation, visibleParagraphIds);

    if (!summarySelection) {
      setAssistError('There is no readable page context to summarize.');
      return;
    }

    setSelection(null);
    setContextSelection(summarySelection);
    setIsSelectionSettling(false);
    setIsAskOpen(false);
    setIsSavedNotesOpen(false);
    setIsSearchOpen(false);
    setIsTocOpen(false);
    setAskContextScope('visiblePage');
    setLastAskRequest(null);
    await runAssistForSelection(summarySelection, 'summarize', undefined, 'visiblePage');
  }

  async function runContextAssist(action: InsightAction, questionText?: string, contextScope?: AssistContextScope) {
    if (!contextSelection) {
      return;
    }

    await runAssistForSelection(
      contextSelection,
      action,
      questionText,
      contextScope ?? contextSelection.contextScope ?? 'visiblePage',
    );
  }

  async function runAssist(
    action: InsightAction,
    questionText?: string,
    contextScope: AssistContextScope = 'paragraph',
  ) {
    if (!selection) {
      return;
    }

    const assistSelection =
      contextScope === 'visiblePage'
        ? {
            ...selection,
            visibleParagraphIds,
          }
        : selection;

    await runAssistForSelection(assistSelection, action, questionText, contextScope);
  }

  function showExample() {
    if (selection) {
      void runAssist(
        'example',
        lastAskRequest?.question,
        lastAskRequest?.contextScope ?? 'paragraph',
      );
      return;
    }

    if (contextSelection) {
      void runContextAssist(
        'example',
        lastAskRequest?.question,
        lastAskRequest?.contextScope ?? contextSelection.contextScope ?? 'visiblePage',
      );
    }
  }

  async function runAssistForSelection(
    assistSelection: ReaderSelection,
    action: InsightAction,
    questionText?: string,
    contextScope: AssistContextScope = 'paragraph',
  ) {
    const requestId = assistRequestId.current + 1;
    assistRequestId.current = requestId;

    setSelectedAction(action);
    setInsight(null);
    setBookAskSources([]);
    setAssistError(null);
    setIsAssistLoading(true);

    try {
      const nextInsight = await requestAssist(
        createAssistPayload(assistSelection, action, currentBook, questionText, contextScope),
      );

      if (assistRequestId.current === requestId) {
        setInsight(nextInsight);
        // Append to conversation so every insight is available as history when the
        // user opens the thread. Using a per-action label as the user turn keeps
        // the thread readable without requiring the user to explicitly "Ask more"
        // between each action (explain → example → thread: both are there).
        const actionLabel: Partial<Record<InsightAction, string>> = {
          summarize: "Summarize what's on this page",
          explain: 'Explain this passage',
          example: 'Give me an example',
          rephrase: 'Rephrase this',
        };
        const turnQuestion = questionText ?? actionLabel[action] ?? 'Tell me about this';
        const turnSelectedText = assistSelection.text;
        const turnParagraphId = assistSelection.paragraphId;
        updateActiveLibraryItem((item) => {
          const last = item.conversation[item.conversation.length - 1];
          if (last?.role === 'assistant' && last.text === nextInsight.body) {
            return item; // exact same result already in history, skip
          }
          return {
            ...item,
            conversation: appendTurns(
              item.conversation,
              { role: 'user', text: turnQuestion, selectedText: turnSelectedText, contextParagraphId: turnParagraphId },
              { role: 'assistant', text: nextInsight.body },
            ),
          };
        });
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
    const insightSelection = selection ?? contextSelection;

    if (isSaved || !insight || !insightSelection || !selectedAction) {
      return;
    }

    updateActiveLibraryItem((item) => ({
      ...item,
      lastOpenedAt: new Date().toISOString(),
      savedInsights: [
        ...item.savedInsights,
        {
          action: selectedAction,
          body: insight.body,
          bookTitle: currentBook.title,
          createdAt: new Date().toISOString(),
          eyebrow: insight.eyebrow,
          id: createSavedInsightId(insightSelection, selectedAction, insight),
          paragraphId: insightSelection.paragraphId,
          selectedText: insightSelection.text,
          selectionKind: insightSelection.selectionKind,
          sourceRef: getParagraphSourceRef(insightSelection.paragraphId, currentBook),
        },
      ],
    }));
  }

  function deleteSavedInsight(noteId: string) {
    if (editingNote?.id === noteId) {
      setEditingNote(null);
      setEditingNoteText('');
    }

    updateActiveLibraryItem((item) => ({
      ...item,
      lastOpenedAt: new Date().toISOString(),
      savedInsights: item.savedInsights.filter((savedInsight) => savedInsight.id !== noteId),
    }));
  }

  function startEditingSavedInsight(note: SavedInsight, options?: { justCreated?: boolean }) {
    setEditingNote(note);
    setEditingNoteText(note.userNote ?? '');
    setEditingNoteQuestion(getEditableSavedNoteQuestion(note) ?? '');
    setEditingNoteJustCreated(options?.justCreated ?? false);
  }

  function cancelEditingSavedInsight() {
    setEditingNote(null);
    setEditingNoteText('');
    setEditingNoteQuestion('');
    setEditingNoteJustCreated(false);
  }

  function saveEditedSavedInsight() {
    if (!editingNote) {
      return;
    }

    const trimmedNote = editingNoteText.trim();
    const trimmedQuestion = editingNoteQuestion.trim();
    const updatedAt = new Date().toISOString();

    updateActiveLibraryItem((item) => ({
      ...item,
      lastOpenedAt: updatedAt,
      savedInsights: item.savedInsights.map((savedInsight) =>
        savedInsight.id === editingNote.id
          ? {
              ...savedInsight,
              // Only notes that have — or can have — an editable question can gain one, so
              // editing a highlight can't silently invent a headline for it, while an `ask`
              // note saved before the question field existed can finally persist one.
              question:
                getEditableSavedNoteQuestion(editingNote) === undefined
                  ? savedInsight.question
                  : trimmedQuestion || undefined,
              updatedAt,
              userNote: trimmedNote || undefined,
            }
          : savedInsight,
      ),
    }));
    setEditingNote(null);
    setEditingNoteText('');
    setEditingNoteQuestion('');
  }

  async function copySavedInsightsToClipboard() {
    if (savedInsights.length === 0) {
      return;
    }

    await Clipboard.setStringAsync(formatSavedInsightsForExport(currentBook, savedInsights));
    setNotesCopyFeedback(true);

    if (notesCopyFeedbackTimer.current) {
      clearTimeout(notesCopyFeedbackTimer.current);
    }

    notesCopyFeedbackTimer.current = setTimeout(() => {
      setNotesCopyFeedback(false);
    }, 1500);
  }

  async function exportSavedInsights() {
    if (savedInsights.length === 0 || notesExportPending) {
      return;
    }

    setNotesExportPending(true);

    try {
      await exportSavedInsightsAsMarkdown(currentBook, savedInsights);
    } catch (error) {
      Alert.alert('Export failed', 'Could not export saved notes. Please try again.');
    } finally {
      setNotesExportPending(false);
    }
  }

  async function exportSavedInsightsAsAnki() {
    if (savedInsights.length === 0 || notesExportPending) {
      return;
    }

    setNotesExportPending(true);

    try {
      const sourceNotes: AnkiSourceNote[] = savedInsights.map((note) => ({
        id: note.id,
        action: note.action,
        question: getSavedNoteHeadline(note),
        body: note.body,
        selectedText: note.selectedText,
        userNote: note.userNote,
      }));

      const needsAiNotes = sourceNotes.filter((note) => classifyNoteForAnkiExport(note) !== 'formatted');
      let aiResults: AnkiCardResult[] = [];

      if (needsAiNotes.length > 0) {
        try {
          aiResults = await requestAnkiCards({
            apiBaseUrl,
            notes: needsAiNotes.map(toAnkiNoteInput),
          });
        } catch (error) {
          // The ask-note cards below have no network dependency and still export —
          // only the notes that needed AI help are missing from this deck.
          Alert.alert(
            'Some notes skipped',
            'Your Q&A notes will still export, but the rest could not be turned into flashcards right now.',
          );
        }
      }

      const cards = buildCardsFromResults(sourceNotes, aiResults);

      if (cards.length === 0) {
        Alert.alert('Nothing to export', 'No saved notes could be turned into flashcards.');
        return;
      }

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        throw new Error('Sharing is not available on this device.');
      }

      const fileUri = `${FileSystem.cacheDirectory}${slugifyForFileName(currentBook.title)}-anki.txt`;
      await FileSystem.writeAsStringAsync(fileUri, buildAnkiFile(cards));
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/plain',
        dialogTitle: 'Export to Anki',
      });
    } catch (error) {
      Alert.alert('Export failed', 'Could not export flashcards. Please try again.');
    } finally {
      setNotesExportPending(false);
    }
  }

  function promptNotesExportFormat() {
    if (savedInsights.length === 0 || notesExportPending) {
      return;
    }

    Alert.alert('Export saved notes', 'Choose a format.', [
      { text: 'Markdown', onPress: () => void exportSavedInsights() },
      { text: 'Anki flashcards', onPress: () => void exportSavedInsightsAsAnki() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function navigateToSource(paragraphId: string, excerpt?: string) {
    setIsThreadCollapsed(true);
    updateReadingLocation(paragraphId);
    setScrollTarget({ nonce: Date.now(), paragraphId, excerpt });
  }

  function confirmSignOut() {
    Alert.alert(
      'Sign out?',
      "You'll need to sign in again to use Whole-Book AI (Ask the book, mind maps). Your library and notes stay on this device.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } },
      ],
    );
  }

  function openConversationThread() {
    if (!canUseWholeBookAi(activeLibraryItem)) {
      setIsWholeBookAiOpen(true);
      return;
    }
    setAssistError(null);
    setIsAskOpen(false);
    setIsThreadCollapsed(false);
    setIsThreadOpen(true);
  }

  function clearConversation() {
    if (activeLibraryItem.conversation.length === 0) {
      return;
    }
    Alert.alert(
      'Clear conversation?',
      "This book's current questions and answers will be cleared. You'll start fresh.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            updateActiveLibraryItem((item) => ({
              ...item,
              archivedConversations: [...(item.archivedConversations ?? []), item.conversation],
              conversation: [],
            }));
          },
        },
      ],
    );
  }

  async function runBookAsk(
    questionText: string,
    ctx?: { quotedText: string; quotedTurnId?: string },
    opts?: { skipUserTurn?: boolean; allowGeneralKnowledge?: boolean },
  ) {
    // Capture before any awaits — clearContextChip() is called immediately on submit
    // which clears selection state, so we must snapshot it here while it's still set.
    const activeCtx = selection ?? contextSelection;
    // ctx comes from long-pressing an answer in the thread; takes priority over the
    // book-selection chip. Long-pressed answers have no book paragraphId to navigate to.
    const chipText = ctx?.quotedText ?? activeCtx?.text ?? undefined;
    const chipParagraphId = ctx ? undefined : activeCtx?.paragraphId ?? undefined;
    const chipTurnId = ctx?.quotedTurnId ?? undefined;
    // Only real book text goes to the API as selectedText — the backend frames it as
    // "For context, I was reading: ...", which is false when ctx is a long-pressed AI
    // answer, not a book passage. A quoted AI answer goes through quotedAnswer instead,
    // which the backend phrases honestly as "your own earlier answer."
    const apiSelectedText = ctx ? undefined : activeCtx?.text ?? undefined;
    const cloudBookId = activeLibraryItem.wholeBookAi.cloudBookId;

    if (!cloudBookId) {
      setAssistError('Whole-Book AI is not enabled for this book.');
      return;
    }

    const token = await getAccessToken();

    if (!token) {
      // Surface it in the thread, and open sign-in so the user can re-authenticate
      // (the session likely expired). Closing the thread keeps sign-in visible.
      setAssistError('Your sign-in has expired. Please sign in again to ask the book.');
      setIsThreadOpen(false);
      setIsSignInOpen(true);
      return;
    }

    const paragraphId = readingLocation?.paragraphId ?? currentBook.paragraphs[0]?.id ?? '';
    const readingOrder = Math.max(0, getParagraphIndex(paragraphId, currentBook.paragraphs));
    const requestId = assistRequestId.current + 1;
    assistRequestId.current = requestId;

    setSelectedAction('ask');
    setInsight(null);
    setAssistError(null);
    setPendingRetry(null);
    setIsAssistLoading(true);

    // Show the user turn immediately before waiting for the API.
    // On retry the turn is already in the conversation, so skip.
    if (!opts?.skipUserTurn) {
      updateActiveLibraryItem((item) => ({
        ...item,
        conversation: appendTurns(
          item.conversation,
          { role: 'user', text: questionText, selectedText: chipText, contextParagraphId: chipParagraphId, contextTurnId: chipTurnId },
        ),
      }));
    }

    try {
      const result = await requestBookAsk({
        apiBaseUrl,
        cloudBookId,
        question: questionText,
        currentParagraphId: paragraphId,
        currentReadingOrder: readingOrder,
        includeWholeBook,
        allowGeneralKnowledge: opts?.allowGeneralKnowledge ?? false,
        accessToken: token,
        history: buildHistory(activeLibraryItem.conversation),
        selectedText: apiSelectedText,
        quotedAnswer: ctx?.quotedText,
      });

      if (assistRequestId.current === requestId) {
        setInsight({ body: result.body, eyebrow: result.eyebrow });
        setBookAskSources(result.sources);
        updateActiveLibraryItem((item) => ({
          ...item,
          conversation: appendTurns(
            item.conversation,
            { role: 'assistant', text: result.body, sources: result.sources },
          ),
        }));
      }
    } catch (error) {
      if (assistRequestId.current === requestId) {
        setAssistError(getErrorMessage(error));
        setPendingRetry({ questionText, ctx });
      }
    } finally {
      if (assistRequestId.current === requestId) {
        setIsAssistLoading(false);
      }
    }
  }

  async function runIndexBookFor(libraryItem: LibraryItem, options: { silent?: boolean } = {}) {
    if (inFlightIndexingRef.current.has(libraryItem.id)) {
      return;
    }
    inFlightIndexingRef.current.add(libraryItem.id);
    try {
      await runIndexBookForInner(libraryItem, options);
    } finally {
      inFlightIndexingRef.current.delete(libraryItem.id);
    }
  }

  async function runIndexBookForInner(libraryItem: LibraryItem, options: { silent?: boolean }) {
    const token = await getAccessToken();
    if (!token) {
      if (!options.silent) {
        // Close the Book AI sheet first so the sign-in prompt isn't hidden behind it.
        setIsWholeBookAiOpen(false);
        setIsSignInOpen(true);
      }
      return;
    }

    const client = {
      fetch(path: string, init?: RequestInit) {
        return fetch(`${apiBaseUrl}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        });
      },
    };
    const api = createIndexApi(client);
    const book = libraryItem.book;

    const bookParagraphs = book.paragraphs.map((p) => ({
      id: p.id,
      blockKind: (p.blockKind ?? 'body') as import('./src/rag/types').UploadBlock['blockKind'],
      text: p.segments.map((s) => s.text).join(''),
      sourceRef: p.sourceRef ?? { source: book.source === 'sample' ? 'epub' : (book.source as import('./src/rag/types').DocumentSource) },
      chapterId: undefined as string | undefined,
      chapterTitle: undefined as string | undefined,
    }));

    // Annotate each paragraph with its chapter
    let chapterIdx = 0;
    for (let i = 0; i < bookParagraphs.length; i++) {
      while (
        chapterIdx + 1 < book.chapters.length &&
        book.paragraphs.findIndex((p) => p.id === book.chapters[chapterIdx + 1].paragraphId) <= i
      ) {
        chapterIdx++;
      }
      const chapter = book.chapters[chapterIdx];
      if (chapter) {
        bookParagraphs[i].chapterId = chapter.id;
        bookParagraphs[i].chapterTitle = chapter.title;
      }
    }

    const activeId = libraryItem.id;
    setLibraryItems((items) =>
      items.map((item) =>
        item.id === activeId
          ? { ...item, wholeBookAi: { ...item.wholeBookAi, status: 'uploading', error: undefined } }
          : item,
      ),
    );
    // Keep the sheet open so the user sees Uploading → Indexing → Ready progress.

    const isBeingWatched = () =>
      isWholeBookAiOpenRef.current && activeBookIdRef.current === activeId;

    try {
      const nextState = await indexBook({
        api,
        book: {
          paragraphs: bookParagraphs,
          title: book.title,
          author: book.author,
          source: book.source === 'sample' ? 'epub' : (book.source as 'epub' | 'pdf' | 'scan'),
          clientBookId: libraryItem.id,
          fileName: book.fileName,
        },
        localState: libraryItem.wholeBookAi.cloudBookId ? libraryItem.wholeBookAi : null,
        onProgress: (progress) => {
          setLibraryItems((items) =>
            items.map((item) =>
              item.id === activeId
                ? { ...item, wholeBookAi: { ...item.wholeBookAi, progress } }
                : item,
            ),
          );
        },
      });

      setLibraryItems((items) =>
        items.map((item) =>
          item.id === activeId
            ? {
                ...item,
                wholeBookAi: nextState,
                pendingNotice: isBeingWatched()
                  ? item.pendingNotice
                  : {
                      kind: 'indexing',
                      status: nextState.status === 'ready' ? 'ready' : 'failed',
                      notifiedAt: new Date().toISOString(),
                    },
              }
            : item,
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? `Indexing failed: ${error.message}`
          : 'Indexing failed. Check your connection and try again.';
      setLibraryItems((items) =>
        items.map((item) =>
          item.id === activeId
            ? {
                ...item,
                wholeBookAi: { ...item.wholeBookAi, status: 'failed', error: message },
                pendingNotice: isBeingWatched()
                  ? item.pendingNotice
                  : { kind: 'indexing', status: 'failed', notifiedAt: new Date().toISOString() },
              }
            : item,
        ),
      );
    }
  }

  async function runIndexBook() {
    return runIndexBookFor(activeLibraryItem);
  }

  const MIND_MAP_POLL_INTERVAL_MS = 3_000;
  const MIND_MAP_POLL_MAX_ATTEMPTS = 200;

  // Polls a single book's mind-map generation to completion, independent of
  // whether its screen is open. Guarded by mindMapInFlightRef so a reopened
  // screen (or a resume-check tick) can't start a second overlapping loop for
  // the same book. Always persists the resolved status; only pushes the result
  // onto the on-screen state if that exact book's screen is still the one open.
  async function pollMindMapUntilDone(bookId: string, cloudBookId: string) {
    if (mindMapInFlightRef.current.has(bookId)) {
      return;
    }
    mindMapInFlightRef.current.add(bookId);
    try {
      let attempts = 0;
      while (attempts < MIND_MAP_POLL_MAX_ATTEMPTS) {
        await new Promise<void>((resolve) => setTimeout(resolve, MIND_MAP_POLL_INTERVAL_MS));
        attempts++;

        const token = await getAccessToken();
        if (!token) {
          continue;
        }

        let result;
        try {
          result = await getMindMap(apiBaseUrl, cloudBookId, token);
        } catch {
          continue;
        }

        if (result.status === 'generating' || result.status === 'pending') {
          continue;
        }

        const resolvedStatus: 'ready' | 'failed' = result.status === 'ready' ? 'ready' : 'failed';
        const isBeingWatched = mindMapOpenRef.current && mindMapBookIdRef.current === bookId;

        setLibraryItems((items) =>
          items.map((item) =>
            item.id === bookId
              ? {
                  ...item,
                  mindMapJob: { status: resolvedStatus },
                  pendingNotice: isBeingWatched
                    ? item.pendingNotice
                    : { kind: 'mindmap', status: resolvedStatus, notifiedAt: new Date().toISOString() },
                }
              : item,
          ),
        );

        if (isBeingWatched) {
          setMindMapStatus(result.status);
          setMindMapData(result.data ?? null);
          setMindMapError(result.error);
        }
        return;
      }

      // Exceeded the cap — give up gracefully, matching indexBook.ts's own
      // pollUntilDone philosophy, rather than polling forever.
      setLibraryItems((items) =>
        items.map((item) => (item.id === bookId ? { ...item, mindMapJob: { status: 'failed' } } : item)),
      );
    } finally {
      mindMapInFlightRef.current.delete(bookId);
    }
  }

  async function openMindMap(bookId: string, bookTitle: string, options: { forceGenerate?: boolean } = {}) {
    const libraryItem = libraryItems.find((item) => item.id === bookId);

    if (!libraryItem || libraryItem.wholeBookAi.status !== 'ready') {
      if (bookId !== activeBookId) {
        openLibraryItem(bookId);
      }
      setPendingMindMapAfterEnable({ bookId, bookTitle });
      setIsWholeBookAiOpen(true);
      return;
    }

    const cloudBookId = resolveMindMapBookId(bookId, libraryItem.wholeBookAi);
    const isThisScreenActive = () => mindMapOpenRef.current && mindMapBookIdRef.current === bookId;

    // Reset nav + selection state when opening a different book; preserve for same book.
    if (bookId !== mindMapBookId) {
      setMindMapNavTab('concepts');
      setMindMapNavOpenChapterId(null);
      setMindMapSavedNodeId(null);
      setMindMapSavedChapterId(null);
      setMindMapSavedZooms({});
      mindMapLiveRef.current = { selectedNodeId: null, selectedChapterId: null, zoomStates: {} };
    }
    // Clear the return-chip context — user explicitly opened the map.
    setMindMapReturnBookId(null);

    setMindMapBookId(bookId);
    setMindMapBookTitle(bookTitle);
    setMindMapStatus('pending');
    setMindMapData(null);
    setMindMapError(undefined);
    setMindMapOpen(true);

    if (!cloudBookId) {
      // Shouldn't happen — status is 'ready' only once cloudBookId is set alongside
      // it — but keep this as a type-narrowing guard and fail safe rather than call
      // the API with a null id.
      setMindMapStatus('failed');
      setMindMapError('Failed to load mind map');
      return;
    }

    try {
      const token = await getAccessToken();

      if (!token) {
        setMindMapOpen(false);
        setIsSignInOpen(true);
        return;
      }

      // Check current status
      const current = await getMindMap(apiBaseUrl, cloudBookId, token);

      if (!shouldStartMindMapGeneration(current.status, options.forceGenerate ?? false)) {
        if (isThisScreenActive()) {
          setMindMapStatus(current.status);
          setMindMapData(current.data ?? null);
          setMindMapError(current.error);
        }
        return;
      }

      // Not ready — trigger generation
      await generateMindMap(apiBaseUrl, cloudBookId, token);

      if (isThisScreenActive()) {
        setMindMapStatus('generating');
      }
      setLibraryItems((items) =>
        items.map((item) =>
          item.id === bookId ? { ...item, mindMapJob: { status: 'generating' } } : item,
        ),
      );

      void pollMindMapUntilDone(bookId, cloudBookId);
    } catch (err) {
      if (isThisScreenActive()) {
        setMindMapStatus('failed');
        setMindMapError(err instanceof Error ? err.message : 'Failed to load mind map');
      }
    }
  }

  function closeMindMap() {
    // Snapshot live selection + zoom so they survive the unmount and can be
    // restored when the map reopens for the same book.
    const live = mindMapLiveRef.current;
    setMindMapSavedNodeId(live.selectedNodeId);
    setMindMapSavedChapterId(live.selectedChapterId);
    setMindMapSavedZooms({ ...live.zoomStates });
    setMindMapOpen(false);
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={[styles.phoneShell, Platform.OS !== 'web' && styles.nativeShell]}>
          {isLibraryOpen ? (
            <LibraryScreen
              activeBookId={activeBookId}
              errorMessage={importError}
              isAuthenticated={isAuthenticated}
              isImportingBook={isImportingBook}
              isScanningDocument={isScanningDocument}
              items={libraryItems}
              onDeleteBook={deleteLibraryItem}
              onDismissError={() => setImportError(null)}
              onImportBook={importBook}
              onOpenBook={openLibraryItem}
              onOpenMindMap={(bookId, bookTitle) => { void openMindMap(bookId, bookTitle); }}
              onScanDocument={scanDocumentPage}
              onSignIn={() => setIsSignInOpen(true)}
              onSignOut={confirmSignOut}
              scanStageLabel={scanStageLabel}
            />
          ) : (
            <View style={styles.readerScreen}>
              <ReaderHeader
                book={currentBook}
                hasMapReturn={mindMapReturnBookId === activeLibraryItem.id}
                isImportingBook={isImportingBook}
                isScanningDocument={isScanningDocument}
                onImportBook={importBook}
                onOpenLibrary={openLibrary}
                onOpenMindMap={() => { void openMindMap(activeLibraryItem.id, currentBook.title); }}
                onScanDocument={scanDocumentPage}
              />

              {importError ? <ImportErrorBanner message={importError} onDismiss={() => setImportError(null)} /> : null}

              {scanStageLabel ? <ScanProgressBanner label={scanStageLabel} /> : null}

              <ReaderSurface
                html={readerHtml}
                onClearSelection={clearSelection}
                onSelectionMessage={handleReaderMessage}
                paragraphs={currentBook.paragraphs}
                scrollTarget={scrollTarget}
              />

              {selection && !isSelectionSettling ? (
                <SelectionPanel
                  activeAction={selectedAction}
                  errorMessage={assistError}
                  insight={insight}
                  isCopied={copiedSelectionId === selection.id}
                  isHighlighted={highlightedSelectionId === selection.id}
                  isLoading={isAssistLoading}
                  isSaved={isSaved}
                  onAskMore={openConversationThread}
                  onChooseAction={chooseAction}
                  onExample={showExample}
                  onMakeSimpler={() => void runAssist('simpler')}
                  onSave={saveInsight}
                  selectionKind={selection.selectionKind}
                  sources={bookAskSources}
                  onNavigateSource={navigateToSource}
                />
              ) : null}

              <ReaderFooter
                progress={readerProgress}
                isSummarizing={isAssistLoading && selectedAction === 'summarize'}
                onOpenAsk={openConversationThread}
                onOpenSavedNotes={() => setIsSavedNotesOpen(true)}
                onOpenSearch={openSearch}
                onOpenTableOfContents={() => setIsTocOpen(true)}
                onSummarizePage={() => void summarizeVisiblePage()}
                savedCount={savedInsights.length}
              />

              {!selection && contextSelection ? (
                <ContextInsightPanel
                  errorMessage={assistError}
                  insight={insight}
                  isLoading={isAssistLoading}
                  isSaved={isSaved}
                  onAskMore={openConversationThread}
                  onExample={showExample}
                  onMakeSimpler={() => void runContextAssist('simpler')}
                  onSave={saveInsight}
                  sources={bookAskSources}
                  onNavigateSource={navigateToSource}
                />
              ) : null}

              {isThreadOpen && !isThreadCollapsed ? (
                <View style={styles.sheetLayer}>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.sheetScrim}
                    onPress={() => setIsThreadOpen(false)}
                  />
                  <View pointerEvents="box-none" style={styles.threadKeyboardContainer}>
                    <View style={styles.threadSheet}>
                      <ConversationThread
                        turns={activeLibraryItem.conversation}
                        includeWholeBook={includeWholeBook}
                        selectedText={(selection ?? contextSelection)?.text ?? undefined}
                        isLoading={isAssistLoading && selectedAction === 'ask'}
                        error={assistError}
                        onSubmit={(text, ctx) => {
                          setIsThreadCollapsed(false);
                          void runBookAsk(text, ctx);
                        }}
                        onRetry={pendingRetry ? () => {
                          const { questionText, ctx } = pendingRetry;
                          void runBookAsk(questionText, ctx, { skipUserTurn: true });
                        } : undefined}
                        onToggleWholeBook={() => setIncludeWholeBook((value) => !value)}
                        onClear={clearConversation}
                        onNavigateSource={navigateToSource}
                        onClearSelection={clearContextChip}
                        onClose={() => setIsThreadOpen(false)}
                        onSaveTurn={saveChatTurn}
                        savedTurnIds={savedChatTurnIds}
                      />
                    </View>
                  </View>
                </View>
              ) : null}

              {isThreadOpen && isThreadCollapsed ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reopen conversation"
                  onPress={() => setIsThreadCollapsed(false)}
                  style={styles.peekBar}
                >
                  <Text style={styles.peekText}>
                    Conversation · {countQuestions(activeLibraryItem.conversation)} questions
                  </Text>
                  <Text style={styles.peekReopen}>Tap to reopen ▲</Text>
                </Pressable>
              ) : null}

              {isTocOpen ? (
                <TableOfContentsSheet
                  chapters={currentBook.chapters}
                  onClose={() => setIsTocOpen(false)}
                  onSelectChapter={jumpToChapter}
                />
              ) : null}

              {isSearchOpen ? (
                <SearchSheet
                  onChangeScope={setSearchScope}
                  onChangeQuery={setSearchQuery}
                  onClose={() => setIsSearchOpen(false)}
                  onSelectResult={jumpToSearchResult}
                  query={searchQuery}
                  results={searchResults}
                  scope={searchScope}
                />
              ) : null}

              {isSavedNotesOpen ? (
                <SavedNotesSheet
                  copyFeedback={notesCopyFeedback}
                  exportPending={notesExportPending}
                  notes={savedInsights}
                  onClose={() => {
                    setIsSavedNotesOpen(false);
                    cancelEditingSavedInsight();
                  }}
                  onCopyNotes={() => void copySavedInsightsToClipboard()}
                  onDeleteNote={deleteSavedInsight}
                  onEditNote={startEditingSavedInsight}
                  onExportNotes={promptNotesExportFormat}
                  onSearchNotes={setNoteSearchQuery}
                  onSelectNote={(note) => (note.action === 'ask' ? startEditingSavedInsight(note) : openSavedInsight(note))}
                  searchQuery={noteSearchQuery}
                />
              ) : null}

              {editingNote ? (
                <SavedNoteEditorSheet
                  closeLabel={editingNoteJustCreated ? 'Done' : 'Cancel'}
                  note={editingNote}
                  noteQuestion={editingNoteQuestion}
                  noteText={editingNoteText}
                  onChangeNoteQuestion={setEditingNoteQuestion}
                  onChangeNoteText={setEditingNoteText}
                  onClose={cancelEditingSavedInsight}
                  // A citation chip navigates the reader behind this sheet, so both it and
                  // the notes list below it have to close first or the passage lands under
                  // a dimmed overlay. Closing discards an in-progress edit, exactly as the
                  // sheet's own X and Cancel already do.
                  onNavigateSource={(paragraphId, excerpt) => {
                    cancelEditingSavedInsight();
                    setIsSavedNotesOpen(false);
                    navigateToSource(paragraphId, excerpt);
                  }}
                  onSave={saveEditedSavedInsight}
                />
              ) : null}
            </View>
          )}
        </View>
      </SafeAreaView>

      {isWholeBookAiOpen ? (
        <WholeBookAiSheet
          state={activeLibraryItem.wholeBookAi}
          onClose={() => {
            setIsWholeBookAiOpen(false);
            setPendingMindMapAfterEnable(null);
          }}
          onEnable={() => { void runIndexBook(); }}
          onRetry={() => { void runIndexBook(); }}
        />
      ) : null}

      <SessionExpiredBanner
        onDismiss={dismissSessionExpiredNotice}
        onSignIn={() => setIsSignInOpen(true)}
        sessionExpired={sessionExpired && !isSignInOpen}
      />

      <BackgroundJobBanner
        notice={pendingNotice}
        onDismiss={() => {
          if (pendingNotice) {
            clearPendingNoticeOfKind(pendingNotice.bookId, pendingNotice.kind);
          }
        }}
        onView={() => {
          if (!pendingNotice) {
            return;
          }
          const { bookId, bookTitle, kind } = pendingNotice;
          clearPendingNoticeOfKind(bookId, kind);
          openLibraryItem(bookId);
          if (kind === 'indexing') {
            setIsWholeBookAiOpen(true);
          } else {
            void openMindMap(bookId, bookTitle);
          }
        }}
      />

      {isSignInOpen ? (
        <SignInSheet
          error={authError}
          isLoading={isSigningIn}
          onClose={() => {
            setIsSignInOpen(false);
            setPendingAuthenticatedAction(null);
          }}
          onSignIn={async () => {
            setIsSigningIn(true);
            await signIn();
            setIsSigningIn(false);
            // If there is a pendingAuthenticatedAction, the useEffect watching
            // isAuthenticated will dispatch it once the auth state updates.
            if (!pendingAuthenticatedAction) {
              setIsSignInOpen(false);
            }
          }}
        />
      ) : null}

      {mindMapOpen && mindMapBookId ? (
        <MindMapScreen
          bookTitle={mindMapBookTitle}
          bookId={mindMapBookId}
          status={mindMapStatus}
          data={mindMapData}
          error={mindMapError}
          initialTab={mindMapNavTab}
          initialOpenChapterId={mindMapNavOpenChapterId}
          onNavigationChange={(tab, openChapterId) => {
            setMindMapNavTab(tab);
            setMindMapNavOpenChapterId(openChapterId);
          }}
          initialSelectedNodeId={mindMapSavedNodeId}
          initialSelectedChapterId={mindMapSavedChapterId}
          initialZoomStates={mindMapSavedZooms}
          liveStateRef={mindMapLiveRef}
          onClose={closeMindMap}
          onRetry={() => {
            setMindMapStatus('generating');
            setMindMapData(null);
            void openMindMap(mindMapBookId, mindMapBookTitle, { forceGenerate: true });
          }}
          onJumpToPassage={(passageId) => {
            // The mind map can be opened from the library list, so make sure the
            // book is open in the reader before scrolling to the passage.
            setMindMapReturnBookId(mindMapBookId); // enable "← Map" return chip
            closeMindMap();
            openLibraryItem(mindMapBookId);
            setScrollTarget({ nonce: Date.now(), paragraphId: passageId });
          }}
          onAsk={(_node) => {
            // Ensure the mind map's book is the active book before opening the
            // thread (the map may have been launched from the library list).
            closeMindMap();
            openLibraryItem(mindMapBookId);
            // activeLibraryItem won't reflect the new book until the next render,
            // so guard against the target item directly rather than via it.
            const targetItem = libraryItems.find((i) => i.id === mindMapBookId);
            if (targetItem && canUseWholeBookAi(targetItem)) {
              // Mind-map-driven questions are about concepts from anywhere in the
              // book, not just what's been read so far — default the thread to
              // whole-book scope. openLibraryItem() above already reset it to
              // false, so this must come after. Stays on for the rest of the
              // thread (including follow-ups typed manually) until the user
              // toggles it off themselves.
              setIncludeWholeBook(true);
              setAssistError(null);
              setIsAskOpen(false);
              setIsThreadCollapsed(false);
              setIsThreadOpen(true);
            } else {
              setIsWholeBookAiOpen(true);
            }
          }}
          onQuickAsk={(question, allowGeneralKnowledge) => {
            // Switch to the map's book, leave a "← Map" breadcrumb, and queue the
            // ready-made question — the effect fires it once the book is active.
            setMindMapReturnBookId(mindMapBookId);
            closeMindMap();
            openLibraryItem(mindMapBookId);
            // See the onAsk handler above for why this must come after
            // openLibraryItem() and why it's sticky for the whole thread.
            setIncludeWholeBook(true);
            setPendingQuickAsk({ bookId: mindMapBookId, question, allowGeneralKnowledge });
          }}
        />
      ) : null}
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ReaderApp />
    </AuthProvider>
  );
}

function LibraryScreen({
  activeBookId,
  errorMessage,
  isAuthenticated,
  isImportingBook,
  isScanningDocument,
  items,
  onDeleteBook,
  onDismissError,
  onImportBook,
  onOpenBook,
  onOpenMindMap,
  onScanDocument,
  onSignIn,
  onSignOut,
  scanStageLabel,
}: {
  activeBookId: string;
  errorMessage: string | null;
  isAuthenticated: boolean;
  isImportingBook: boolean;
  isScanningDocument: boolean;
  items: LibraryItem[];
  onDeleteBook: (bookId: string) => void;
  onDismissError: () => void;
  onImportBook: () => void;
  onOpenBook: (bookId: string) => void;
  onOpenMindMap: (bookId: string, bookTitle: string) => void;
  onScanDocument: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  scanStageLabel: string | null;
}) {
  const sortedItems = [...items].sort((firstItem, secondItem) =>
    getSortableOpenedAt(secondItem).localeCompare(getSortableOpenedAt(firstItem)),
  );

  return (
    <View style={styles.libraryScreen}>
      <View style={styles.libraryHeader}>
        <View style={styles.libraryTitleRow}>
          <LibraryIcon color={colors.ink} size={23} strokeWidth={2} />
          <Text style={styles.libraryTitle}>Library</Text>
        </View>
        <View style={styles.libraryHeaderActions}>
          {isAuthenticated ? (
            <Pressable
              accessibilityLabel="Sign out"
              accessibilityRole="button"
              onPress={onSignOut}
              style={styles.libraryAccountButton}
            >
              <LogOut color={colors.ink} size={18} strokeWidth={2} />
              <Text style={styles.libraryScanText}>Sign out</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="Sign in"
              accessibilityRole="button"
              onPress={onSignIn}
              style={styles.libraryAccountButton}
            >
              <LogIn color={colors.ink} size={18} strokeWidth={2} />
              <Text style={styles.libraryScanText}>Sign in</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityLabel="Scan page with camera"
            accessibilityRole="button"
            disabled={isScanningDocument || isImportingBook}
            onPress={onScanDocument}
            style={[styles.libraryScanButton, (isScanningDocument || isImportingBook) && styles.disabledButton]}
          >
            {isScanningDocument ? (
              <ActivityIndicator color={colors.ink} size="small" />
            ) : (
              <Camera color={colors.ink} size={18} strokeWidth={2.2} />
            )}
            <Text style={styles.libraryScanText}>{scanStageLabel ?? 'Scan'}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Import EPUB or PDF"
            accessibilityRole="button"
            disabled={isImportingBook || isScanningDocument}
            onPress={onImportBook}
            style={[styles.libraryImportButton, (isImportingBook || isScanningDocument) && styles.disabledButton]}
          >
            {isImportingBook ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Upload color={colors.white} size={18} strokeWidth={2.2} />
            )}
            <Text style={styles.libraryImportText}>{isImportingBook ? 'Reading...' : 'Import'}</Text>
          </Pressable>
        </View>
      </View>

      {errorMessage ? <ImportErrorBanner message={errorMessage} onDismiss={onDismissError} /> : null}

      <ScrollView contentContainerStyle={styles.libraryList} showsVerticalScrollIndicator={false}>
        {sortedItems.map((item) => {
          const progress = getLibraryItemProgress(item);
          const isActive = item.id === activeBookId;
          const canDelete = item.book.source !== 'sample' && items.length > 1;

          return (
            <View key={item.id} style={[styles.libraryBookCard, isActive && styles.libraryBookCardActive]}>
              <View style={styles.libraryBookTop}>
                <View style={styles.libraryBookIcon}>
                  <FileText color={colors.sageDark} size={18} strokeWidth={2} />
                </View>
                <View style={styles.libraryBookTitleBlock}>
                  <Text numberOfLines={2} style={styles.libraryBookTitle}>
                    {item.book.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.libraryBookAuthor}>
                    {item.book.author}
                  </Text>
                </View>
                {canDelete ? (
                  <Pressable
                    accessibilityLabel={`Remove ${item.book.title}`}
                    accessibilityRole="button"
                    onPress={() => onDeleteBook(item.id)}
                    style={styles.libraryDeleteButton}
                  >
                    <Trash2 color={colors.mutedInk} size={18} strokeWidth={2} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.libraryBookMetaRow}>
                <Text numberOfLines={1} style={styles.libraryBookMeta}>
                  {progress.page}
                </Text>
                <Text style={styles.libraryBookMeta}>{item.savedInsights.length} notes</Text>
              </View>

              <View style={styles.libraryBookMetaRow}>
                <Text numberOfLines={1} style={styles.libraryBookMeta}>
                  {formatBookSourceMeta(item.book)}
                </Text>
                <Text numberOfLines={1} style={styles.libraryBookMeta}>
                  {formatOpenedAt(item)}
                </Text>
              </View>

              <View style={styles.libraryProgressTrack}>
                <View style={[styles.libraryProgressFill, { width: `${progress.percent}%` }]} />
              </View>

              <View style={styles.libraryCardActions}>
                <Pressable
                  accessibilityLabel={`Resume ${item.book.title}`}
                  accessibilityRole="button"
                  onPress={() => onOpenBook(item.id)}
                  style={({ pressed }) => [
                    styles.libraryResumeButton,
                    styles.libraryResumeButtonFlex,
                    isActive && styles.libraryResumeButtonActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <BookOpen color={isActive ? colors.white : colors.ink} size={17} strokeWidth={2} />
                  <Text style={[styles.libraryResumeText, isActive && styles.libraryResumeTextActive]}>
                    {isActive ? 'Resume current' : 'Resume'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Mind map for ${item.book.title}`}
                  accessibilityRole="button"
                  onPress={() => onOpenMindMap(item.id, item.book.title)}
                  style={({ pressed }) => [styles.libraryMindMapButton, pressed && styles.pressed]}
                >
                  <Text style={styles.libraryMindMapText}>🗺 Mind Map</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function getSortableOpenedAt(item: LibraryItem) {
  return item.lastOpenedAt === 'sample' ? '' : item.lastOpenedAt;
}

function formatOpenedAt(item: LibraryItem) {
  if (item.book.source === 'sample') {
    return 'Starter';
  }

  const openedAt = new Date(item.lastOpenedAt);

  if (Number.isNaN(openedAt.getTime())) {
    return item.book.source.toUpperCase();
  }

  return openedAt.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
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

  function injectScrollToTarget(target: ScrollTarget) {
    // A citation excerpt is the start of the retrieved chunk's text. We try the
    // exact paragraph id first, then fall back to finding the excerpt text in the
    // rendered page, so navigation lands on the quoted passage even if the id
    // doesn't resolve. Whatever we land on gets a brief highlight.
    const excerpt = (target.excerpt ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    webViewRef.current?.injectJavaScript(`
      (function () {
        function flash(el) {
          if (!el) return;
          el.classList.remove('reader-citation-flash');
          // reflow so the animation restarts on repeat taps
          void el.offsetWidth;
          el.classList.add('reader-citation-flash');
          setTimeout(function () { el.classList.remove('reader-citation-flash'); }, 2600);
        }
        function land(el) {
          if (!el) return false;
          el.scrollIntoView({ block: 'start', behavior: 'smooth' });
          flash(el);
          // With content-visibility:auto, off-screen blocks use estimated heights,
          // so a single long scrollIntoView lands imprecisely. Re-scroll a few times
          // as the real content renders to converge on the exact target.
          setTimeout(function () { el.scrollIntoView({ block: 'start', behavior: 'auto' }); }, 350);
          setTimeout(function () { el.scrollIntoView({ block: 'start', behavior: 'auto' }); }, 750);
          setTimeout(function () { el.scrollIntoView({ block: 'start', behavior: 'auto' }); }, 1200);
          return true;
        }
        if (land(document.getElementById(${JSON.stringify(target.paragraphId)}))) return;
        var ex = ${JSON.stringify(excerpt)};
        if (!ex) return;
        // The excerpt is the start of the retrieved chunk's text and may span a
        // heading + body (separate blocks). Find the block sharing the longest
        // leading run of characters with the excerpt — that's the chunk's first
        // paragraph — so we land even across heading/body splits.
        var blocks = document.querySelectorAll('.reader-block');
        var best = null, bestLen = 0;
        for (var i = 0; i < blocks.length; i++) {
          var t = (blocks[i].textContent || '').toLowerCase().replace(/\\s+/g, ' ').trim();
          if (!t) continue;
          var n = Math.min(t.length, ex.length), k = 0;
          while (k < n && t.charCodeAt(k) === ex.charCodeAt(k)) k++;
          if (k > bestLen) { bestLen = k; best = blocks[i]; }
        }
        if (bestLen >= 16) land(best);
      })();
      true;
    `);
  }

  useEffect(() => {
    if (Platform.OS === 'web' || !scrollTarget) {
      return;
    }

    injectScrollToTarget(scrollTarget);
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
      onLoadEnd={() => {
        if (scrollTarget) {
          injectScrollToTarget(scrollTarget);
        }
      }}
      onMessage={handleMessage}
      onContentProcessDidTerminate={() => {
        // iOS killed the WebView content process (memory pressure). Reload once
        // so the reader recovers instead of showing a blank/flickering view.
        webViewRef.current?.reload();
      }}
      originWhitelist={['*']}
      scrollEnabled
      source={{ html }}
      menuItems={[]}
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
  const locationFrame = useRef<number | null>(null);

  useEffect(() => {
    if (!scrollTarget || typeof document === 'undefined') {
      return;
    }

    document.getElementById(scrollTarget.paragraphId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollTarget]);

  useEffect(() => {
    return () => {
      if (locationFrame.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(locationFrame.current);
      }
    };
  }, []);

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

  function handleScrollLocation() {
    if (typeof document === 'undefined' || typeof window === 'undefined' || locationFrame.current !== null) {
      return;
    }

    locationFrame.current = window.requestAnimationFrame(() => {
      locationFrame.current = null;
      const viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0;
      const visibleParagraphs = paragraphs.filter((paragraph) => {
        const element = document.getElementById(paragraph.id);
        const rect = element?.getBoundingClientRect();
        return rect ? rect.bottom > 96 && rect.top < viewportBottom - 112 : false;
      });
      const visibleParagraph =
        visibleParagraphs[0] ??
        paragraphs.find((paragraph) => {
          const element = document.getElementById(paragraph.id);
          return element ? element.getBoundingClientRect().bottom > 96 : false;
        }) ??
        null;

      if (visibleParagraph) {
        onSelectionMessage({
          paragraphId: visibleParagraph.id,
          type: 'location',
          visibleParagraphIds: visibleParagraphs.length
            ? visibleParagraphs.map((paragraph) => paragraph.id)
            : [visibleParagraph.id],
        });
      }
    });
  }

  return (
    <Pressable accessible={false} onPress={onClearSelection} style={styles.readingLayer}>
      <ScrollView
        contentContainerStyle={styles.readingContent}
        onScroll={handleScrollLocation}
        scrollEventThrottle={250}
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
  hasMapReturn,
  isImportingBook,
  isScanningDocument,
  onImportBook,
  onOpenLibrary,
  onOpenMindMap,
  onScanDocument,
}: {
  book: ReaderBook;
  hasMapReturn: boolean;
  isImportingBook: boolean;
  isScanningDocument: boolean;
  onImportBook: () => void;
  onOpenLibrary: () => void;
  onOpenMindMap: () => void;
  onScanDocument: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Open library"
        accessibilityRole="button"
        onPress={onOpenLibrary}
        style={styles.headerIconButton}
      >
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
        {hasMapReturn ? (
          <Pressable
            accessibilityLabel="Return to mind map"
            accessibilityRole="button"
            onPress={onOpenMindMap}
            style={styles.mapReturnChip}
          >
            <Text style={styles.mapReturnChipText}>← Map</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel="Mind map"
            accessibilityRole="button"
            onPress={onOpenMindMap}
            style={styles.headerIconButton}
          >
            <Text style={styles.headerMindMapIcon}>🗺</Text>
          </Pressable>
        )}
        <Pressable accessibilityLabel="Text settings" accessibilityRole="button" style={styles.headerIconButton}>
          <Type color={colors.ink} size={19} strokeWidth={2} />
        </Pressable>
        <Pressable
          accessibilityLabel="Scan page with camera"
          accessibilityRole="button"
          disabled={isScanningDocument || isImportingBook}
          onPress={onScanDocument}
          style={[styles.headerIconButton, (isScanningDocument || isImportingBook) && styles.disabledButton]}
        >
          {isScanningDocument ? (
            <ActivityIndicator color={colors.sageDark} size="small" />
          ) : (
            <Camera color={colors.ink} size={19} strokeWidth={2} />
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="Import EPUB or PDF"
          accessibilityRole="button"
          disabled={isImportingBook || isScanningDocument}
          onPress={onImportBook}
          style={[styles.headerIconButton, (isImportingBook || isScanningDocument) && styles.disabledButton]}
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

function ScanProgressBanner({ label }: { label: string }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.scanProgressBanner}>
      <ActivityIndicator color={colors.sageDark} size="small" />
      <Text style={styles.scanProgressText}>{label}</Text>
    </View>
  );
}

function ReaderFooter({
  progress,
  isSummarizing,
  onOpenAsk,
  onOpenSavedNotes,
  onOpenSearch,
  onOpenTableOfContents,
  onSummarizePage,
  savedCount,
}: {
  progress: ReaderProgress;
  isSummarizing: boolean;
  onOpenAsk: () => void;
  onOpenSavedNotes: () => void;
  onOpenSearch: () => void;
  onOpenTableOfContents: () => void;
  onSummarizePage: () => void;
  savedCount: number;
}) {
  return (
    <View style={styles.footer}>
      <View style={styles.progressMeta}>
        <Text style={styles.pageText}>{progress.page}</Text>
        <Text style={styles.pageText}>{progress.progress}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
        <View style={[styles.progressThumb, { left: `${Math.min(98, Math.max(0, progress.percent - 1))}%` }]} />
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
        <Pressable
          accessibilityLabel={`${savedCount} saved notes`}
          accessibilityRole="button"
          onPress={onOpenSavedNotes}
          style={styles.bottomIcon}
        >
          <Bookmark color={colors.ink} size={21} strokeWidth={2} />
          {savedCount > 0 ? (
            <View style={styles.savedBadge}>
              <Text style={styles.savedBadgeText}>{savedCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityLabel="Summarize current page"
          accessibilityRole="button"
          disabled={isSummarizing}
          onPress={onSummarizePage}
          style={[styles.bottomIcon, isSummarizing && styles.disabledButton]}
        >
          {isSummarizing ? (
            <ActivityIndicator color={colors.sageDark} size="small" />
          ) : (
            <Sparkles color={colors.ink} size={21} strokeWidth={2} />
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="Ask the book"
          accessibilityRole="button"
          onPress={onOpenAsk}
          style={styles.askPill}
        >
          <Sparkles color={colors.white} size={15} strokeWidth={2.2} />
          <Text style={styles.askPillText}>Ask the book</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Search"
          accessibilityRole="button"
          onPress={onOpenSearch}
          style={styles.bottomIcon}
        >
          <Search color={colors.ink} size={21} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  );
}

function SavedNotesSheet({
  copyFeedback,
  exportPending,
  notes,
  onClose,
  onCopyNotes,
  onDeleteNote,
  onEditNote,
  onExportNotes,
  onSearchNotes,
  onSelectNote,
  searchQuery,
}: {
  copyFeedback: boolean;
  exportPending: boolean;
  notes: SavedInsight[];
  onClose: () => void;
  onCopyNotes: () => void;
  onDeleteNote: (noteId: string) => void;
  onEditNote: (note: SavedInsight) => void;
  onExportNotes: () => void;
  onSearchNotes: (value: string) => void;
  onSelectNote: (note: SavedInsight) => void;
  searchQuery: string;
}) {
  const [activeFilter, setActiveFilter] = useState<SavedNoteFilter>('all');
  const normalizedQuery = normalizeSelectionText(searchQuery).toLowerCase();
  const sortedNotes = [...notes].sort((firstNote, secondNote) =>
    secondNote.createdAt.localeCompare(firstNote.createdAt),
  );
  const filterOptions = getSavedNoteFilterOptions(notes);
  const filteredNotes =
    activeFilter === 'all' ? sortedNotes : sortedNotes.filter((note) => note.action === activeFilter);
  const visibleNotes =
    normalizedQuery.length < 2
      ? filteredNotes
      : filteredNotes.filter((note) => doesSavedNoteMatchQuery(note, normalizedQuery));

  return (
    <View style={styles.sheetLayer}>
      <Pressable accessibilityRole="button" style={styles.sheetScrim} onPress={onClose} />
      <View style={styles.savedNotesSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.savedNotesHeader}>
          <View>
            <Text style={styles.tocTitle}>Saved notes</Text>
            <Text style={styles.savedNotesCount}>{notes.length} total</Text>
          </View>
          <View style={styles.savedNotesActionRow}>
            <Pressable
              accessibilityLabel="Copy saved notes"
              accessibilityRole="button"
              disabled={notes.length === 0}
              onPress={onCopyNotes}
              style={[styles.savedNotesCopyButton, notes.length === 0 && styles.disabledButton]}
            >
              {copyFeedback ? (
                <Check color={colors.sageDark} size={16} strokeWidth={2.2} />
              ) : (
                <CopyIcon color={colors.ink} size={16} strokeWidth={2} />
              )}
              <Text style={[styles.savedNotesCopyText, copyFeedback && styles.savedButtonText]}>
                {copyFeedback ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Export saved notes"
              accessibilityRole="button"
              disabled={notes.length === 0 || exportPending}
              onPress={onExportNotes}
              style={[styles.savedNotesCopyButton, (notes.length === 0 || exportPending) && styles.disabledButton]}
            >
              {exportPending ? (
                <ActivityIndicator color={colors.ink} size="small" />
              ) : (
                <Share2 color={colors.ink} size={16} strokeWidth={2} />
              )}
              <Text style={styles.savedNotesCopyText}>Export</Text>
            </Pressable>
          </View>
        </View>
        {notes.length > 0 ? (
          <View style={styles.savedNotesSearchRow}>
            <Search color={colors.mutedInk} size={17} strokeWidth={2} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onSearchNotes}
              placeholder="Search saved notes"
              placeholderTextColor="#8c8a84"
              returnKeyType="search"
              style={styles.savedNotesSearchInput}
              value={searchQuery}
            />
          </View>
        ) : null}
        {notes.length > 0 ? (
          <ScrollView
            contentContainerStyle={styles.savedNoteFilters}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {filterOptions.map((filter) => {
              const isActive = activeFilter === filter;

              return (
                <Pressable
                  key={filter}
                  accessibilityRole="button"
                  onPress={() => setActiveFilter(filter)}
                  style={[styles.savedNoteFilterButton, isActive && styles.savedNoteFilterButtonActive]}
                >
                  <Text style={[styles.savedNoteFilterText, isActive && styles.savedNoteFilterTextActive]}>
                    {filter === 'all' ? 'All' : getInsightActionLabel(filter)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {sortedNotes.length === 0 ? (
          <View style={styles.emptyNotes}>
            <Bookmark color={colors.mutedInk} size={20} strokeWidth={2} />
            <Text style={styles.emptyNotesText}>Highlights and saved explanations will appear here.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} style={styles.savedNotesList}>
            {visibleNotes.map((note) => {
              const sourceLabel = formatSourceRef(note.sourceRef);

              return (
                <Pressable
                  key={note.id}
                  accessibilityRole="button"
                  onPress={() => onSelectNote(note)}
                  style={({ pressed }) => [styles.savedNoteItem, pressed && styles.pressed]}
                >
                  <View style={styles.savedNoteHeader}>
                    <Text numberOfLines={1} style={styles.savedNoteEyebrow}>
                      {getSavedNoteHeadline(note)}
                    </Text>
                    <View style={styles.savedNoteActions}>
                      <Text style={styles.savedNoteAction}>{getInsightActionLabel(note.action)}</Text>
                      <Pressable
                        accessibilityLabel="Edit saved note"
                        accessibilityRole="button"
                        onPress={(event) => {
                          stopPressPropagation(event);
                          onEditNote(note);
                        }}
                        style={styles.savedNoteIconButton}
                      >
                        <Pencil color={colors.mutedInk} size={15} strokeWidth={2} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Delete saved note"
                        accessibilityRole="button"
                        onPress={(event) => {
                          stopPressPropagation(event);
                          onDeleteNote(note.id);
                        }}
                        style={styles.savedNoteIconButton}
                      >
                        <Trash2 color={colors.mutedInk} size={16} strokeWidth={2} />
                      </Pressable>
                    </View>
                  </View>
                  {sourceLabel ? (
                    <Text numberOfLines={1} style={styles.savedNoteSource}>
                      {sourceLabel}
                    </Text>
                  ) : null}
                  {note.selectedText ? (
                    <Text numberOfLines={2} style={styles.savedNoteSelection}>
                      {note.selectedText}
                    </Text>
                  ) : null}
                  {note.body ? (
                    <Text numberOfLines={3} style={styles.savedNoteBody}>
                      {flattenAnswerMarkdown(note.body)}
                    </Text>
                  ) : null}
                  {note.userNote ? (
                    <Text numberOfLines={2} style={styles.savedNoteUserNote}>
                      Note: {note.userNote}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            {visibleNotes.length === 0 ? (
              <View style={styles.emptyNotes}>
                <Bookmark color={colors.mutedInk} size={20} strokeWidth={2} />
                <Text style={styles.emptyNotesText}>
                  {normalizedQuery.length >= 2 ? 'No saved notes match this search.' : 'No saved notes for this filter.'}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function doesSavedNoteMatchQuery(note: SavedInsight, normalizedQuery: string) {
  // Keep this list in step with getSavedNoteSearchResults' searchableFields — including
  // `question`, so a thread note is findable by the question it answers.
  return [
    note.selectedText,
    note.body,
    note.userNote ?? '',
    note.question ?? '',
    note.eyebrow,
    getInsightActionLabel(note.action),
  ].some((value) => normalizeSelectionText(value).toLowerCase().includes(normalizedQuery));
}

function SavedNoteEditorSheet({
  closeLabel,
  note,
  noteQuestion,
  noteText,
  onChangeNoteQuestion,
  onChangeNoteText,
  onClose,
  onNavigateSource,
  onSave,
}: {
  closeLabel: string;
  note: SavedInsight;
  noteQuestion: string;
  noteText: string;
  onChangeNoteQuestion: (value: string) => void;
  onChangeNoteText: (value: string) => void;
  onClose: () => void;
  onNavigateSource: (paragraphId: string, excerpt?: string) => void;
  onSave: () => void;
}) {
  const editableQuestion = getEditableSavedNoteQuestion(note);
  // Compare against the seeded question, not `note.question`, so opening a legacy `ask`
  // note (question seeded from its eyebrow) doesn't enable Save before anything is edited.
  const canSave =
    noteText.trim() !== (note.userNote ?? '').trim() ||
    noteQuestion.trim() !== (editableQuestion ?? '').trim();
  const sourceLabel = formatSourceRef(note.sourceRef);
  const keyboardOverlap = useKeyboardOverlap();
  const citationSources = (note.citations ?? []).map((citation, index) => ({
    ...citation,
    id: `${note.id}-citation-${index}`,
  }));

  return (
    <View style={styles.sheetLayer}>
      <Pressable accessibilityRole="button" style={styles.sheetScrim} onPress={onClose} />
      <View style={[styles.noteEditorSheet, { paddingBottom: 21 + keyboardOverlap }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.noteEditorHeader}>
          <View>
            <Text style={styles.tocTitle}>Edit note</Text>
            <Text style={styles.savedNotesCount}>
              {sourceLabel ? `${getInsightActionLabel(note.action)} - ${sourceLabel}` : getInsightActionLabel(note.action)}
            </Text>
          </View>
          <Pressable accessibilityLabel="Close note editor" accessibilityRole="button" onPress={onClose} style={styles.noteEditorCloseButton}>
            <X color={colors.ink} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>
        {/* The passage and the AI answer are shown in full here rather than clipped —
            this sheet is the only place a saved note can be read in its entirety, so it
            scrolls instead of truncating. It shrinks while the keyboard is up so the
            note input and the Save button stay reachable on shorter screens. */}
        {editableQuestion !== undefined ? (
          <TextInput
            multiline
            onChangeText={onChangeNoteQuestion}
            placeholder="What was the question?"
            placeholderTextColor="#8c8a84"
            style={styles.noteEditorQuestionInput}
            value={noteQuestion}
          />
        ) : null}
        {note.selectedText || note.body || citationSources.length > 0 ? (
          <ScrollView
            style={[styles.noteEditorContext, keyboardOverlap > 0 && styles.noteEditorContextCompact]}
            contentContainerStyle={styles.noteEditorContextContent}
            // Without this, the first tap on a citation chip while the question or note
            // input has the keyboard up only dismisses the keyboard, swallowing the tap.
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {note.selectedText ? (
              <Text style={styles.noteEditorSelection}>{note.selectedText}</Text>
            ) : null}
            {note.body ? (
              <Pressable
                accessibilityLabel="Go to this note's location in the book"
                accessibilityRole="button"
                onPress={() =>
                  onNavigateSource(note.paragraphId, note.selectedText || note.citations?.[0]?.excerpt)
                }
                style={styles.noteEditorAnswer}
              >
                <AnswerMarkdown text={note.body} />
              </Pressable>
            ) : null}
            {citationSources.length > 0 ? (
              <View style={styles.noteEditorCitations}>
                <BookSources sources={citationSources} onNavigate={onNavigateSource} />
              </View>
            ) : null}
          </ScrollView>
        ) : null}
        <TextInput
          multiline
          onChangeText={onChangeNoteText}
          placeholder="Add your note..."
          placeholderTextColor="#8c8a84"
          style={styles.noteEditorInput}
          textAlignVertical="top"
          value={noteText}
        />
        <View style={styles.sheetActions}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.sheetButton}>
            <X color={colors.ink} size={16} strokeWidth={2} />
            <Text style={styles.sheetButtonText}>{closeLabel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!canSave}
            onPress={onSave}
            style={[styles.sheetButton, styles.primarySheetButton, !canSave && styles.disabledButton]}
          >
            <Check color={colors.white} size={16} strokeWidth={2.2} />
            <Text style={styles.primarySheetButtonText}>Save</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function getSavedNoteFilterOptions(notes: SavedInsight[]): SavedNoteFilter[] {
  const filterOptions: SavedNoteFilter[] = ['all'];

  for (const action of ['summarize', 'explain', 'ask', 'example', 'rephrase', 'simpler', 'highlight'] as InsightAction[]) {
    if (notes.some((note) => note.action === action)) {
      filterOptions.push(action);
    }
  }

  return filterOptions;
}

function getInsightActionLabel(action: InsightAction) {
  switch (action) {
    case 'ask':
      return 'Ask';
    case 'example':
      return 'Example';
    case 'rephrase':
      return 'Rephrase';
    case 'simpler':
      return 'Simpler';
    case 'summarize':
      return 'Summary';
    case 'highlight':
      return 'Highlight';
    default:
      return 'Explain';
  }
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

function SearchSheet({
  onChangeScope,
  onChangeQuery,
  onClose,
  onSelectResult,
  query,
  results,
  scope,
}: {
  onChangeScope: (scope: SearchScope) => void;
  onChangeQuery: (value: string) => void;
  onClose: () => void;
  onSelectResult: (result: SearchResult) => void;
  query: string;
  results: SearchResult[];
  scope: SearchScope;
}) {
  const trimmedQuery = normalizeSelectionText(query);
  const shouldShowEmpty = trimmedQuery.length >= 2 && results.length === 0;
  const placeholder =
    scope === 'notes' ? 'Search saved notes' : scope === 'all' ? 'Search book and notes' : 'Search this book';
  const keyboardOverlap = useKeyboardOverlap();

  return (
    <View style={styles.sheetLayer}>
      <Pressable accessibilityRole="button" style={styles.sheetScrim} onPress={onClose} />
      <View style={styles.keyboardContainer}>
        <View style={[styles.searchSheet, { paddingBottom: 18 + keyboardOverlap }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.searchInputRow}>
            <Search color={colors.mutedInk} size={18} strokeWidth={2} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              onChangeText={onChangeQuery}
              placeholder={placeholder}
              placeholderTextColor="#8c8a84"
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />
          </View>
          <View style={styles.searchScopeRow}>
            {(['book', 'notes', 'all'] as SearchScope[]).map((option) => {
              const isActive = scope === option;

              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  onPress={() => onChangeScope(option)}
                  style={[styles.searchScopeButton, isActive && styles.searchScopeButtonActive]}
                >
                  <Text style={[styles.searchScopeText, isActive && styles.searchScopeTextActive]}>
                    {getSearchScopeLabel(option)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.searchResultsList}>
            {results.map((result) => (
              <Pressable
                key={result.id}
                accessibilityRole="button"
                onPress={() => onSelectResult(result)}
                style={({ pressed }) => [styles.searchResultItem, pressed && styles.pressed]}
              >
                <Text style={styles.searchResultMeta}>{formatSearchResultMeta(result)}</Text>
                <Text numberOfLines={3} style={styles.searchResultExcerpt}>
                  {result.excerpt}
                </Text>
              </Pressable>
            ))}
            {shouldShowEmpty ? (
              <View style={styles.emptyNotes}>
                <Search color={colors.mutedInk} size={20} strokeWidth={2} />
                <Text style={styles.emptyNotesText}>{getSearchScopeEmptyText(scope)}</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

function countQuestions(conversation: ConversationTurn[]) {
  return conversation.filter((turn) => turn.role === 'user').length;
}

function getSearchScopeLabel(scope: SearchScope) {
  switch (scope) {
    case 'all':
      return 'All';
    case 'notes':
      return 'Notes';
    default:
      return 'Book';
  }
}

function getSearchScopeEmptyText(scope: SearchScope) {
  switch (scope) {
    case 'all':
      return 'No matches in this book or saved notes.';
    case 'notes':
      return 'No matches in saved notes.';
    default:
      return 'No matches in this book.';
  }
}

function SelectionPanel({
  activeAction,
  errorMessage,
  insight,
  isCopied,
  isHighlighted,
  isLoading,
  isSaved,
  onAskMore,
  onChooseAction,
  onExample,
  onMakeSimpler,
  onSave,
  selectionKind,
  sources,
  onNavigateSource,
}: {
  activeAction: InsightAction | null;
  errorMessage: string | null;
  insight: Insight | null;
  isCopied: boolean;
  isHighlighted: boolean;
  isLoading: boolean;
  isSaved: boolean;
  onAskMore: () => void;
  onChooseAction: (action: SelectionAction) => void;
  onExample: () => void;
  onMakeSimpler: () => void;
  onSave: () => void;
  selectionKind: SelectionKind;
  sources?: BookSource[];
  onNavigateSource?: (paragraphId: string) => void;
}) {
  return (
    <Pressable accessible={false} onPress={stopPressPropagation} style={styles.selectionPanel}>
      <QuickActionMenu
        activeAction={activeAction}
        isCopied={isCopied}
        isHighlighted={isHighlighted}
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
          onExample={onExample}
          onMakeSimpler={onMakeSimpler}
          onSave={onSave}
          sources={sources}
          onNavigateSource={onNavigateSource}
        />
      ) : null}
    </Pressable>
  );
}

function ContextInsightPanel({
  errorMessage,
  insight,
  isLoading,
  isSaved,
  onAskMore,
  onExample,
  onMakeSimpler,
  onSave,
  sources,
  onNavigateSource,
}: {
  errorMessage: string | null;
  insight: Insight | null;
  isLoading: boolean;
  isSaved: boolean;
  onAskMore: () => void;
  onExample: () => void;
  onMakeSimpler: () => void;
  onSave: () => void;
  sources?: BookSource[];
  onNavigateSource?: (paragraphId: string) => void;
}) {
  return (
    <Pressable accessible={false} onPress={stopPressPropagation} style={styles.selectionPanel}>
      {isLoading ? <LoadingInsightCard /> : null}

      {errorMessage && !isLoading ? <ErrorInsightCard message={errorMessage} /> : null}

      {insight && !isLoading ? (
        <InsightCard
          insight={insight}
          isSaved={isSaved}
          onAskMore={onAskMore}
          onExample={onExample}
          onMakeSimpler={onMakeSimpler}
          onSave={onSave}
          sources={sources}
          onNavigateSource={onNavigateSource}
        />
      ) : null}
    </Pressable>
  );
}

function QuickActionMenu({
  activeAction,
  isCopied,
  isHighlighted,
  onChooseAction,
  selectionKind,
}: {
  activeAction: InsightAction | null;
  isCopied: boolean;
  isHighlighted: boolean;
  onChooseAction: (action: SelectionAction) => void;
  selectionKind: SelectionKind;
}) {
  return (
    <View style={styles.actionMenu}>
      {selectionActions.map(({ action, icon: Icon, label }) => {
        const isCopiedAction = action === 'copy' && isCopied;
        const isHighlightedAction = action === 'highlight' && isHighlighted;
        const isActive = !isCopied && !isHighlighted && activeAction === action;
        const visibleLabel =
          action === 'explain' && selectionKind === 'word'
            ? 'Define'
            : isCopiedAction
              ? 'Copied'
              : isHighlightedAction
                ? 'Saved'
                : label;
        const buttonColor = isActive || isCopiedAction || isHighlightedAction ? colors.sageDark : colors.ink;

        return (
          <Pressable
            key={action}
            accessibilityLabel={visibleLabel}
            accessibilityRole="button"
            onPress={() => onChooseAction(action)}
            style={({ pressed }) => [
              styles.actionButton,
              (isActive || isCopiedAction || isHighlightedAction) && styles.actionButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Icon color={buttonColor} size={20} strokeWidth={1.8} />
            <Text
              style={[
                styles.actionText,
                (isActive || isCopiedAction || isHighlightedAction) && styles.actionTextActive,
              ]}
            >
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
  onExample,
  onMakeSimpler,
  onSave,
  sources = [],
  onNavigateSource,
}: {
  insight: Insight;
  isSaved: boolean;
  onAskMore: () => void;
  onExample: () => void;
  onMakeSimpler: () => void;
  onSave: () => void;
  sources?: BookSource[];
  onNavigateSource?: (paragraphId: string) => void;
}) {
  return (
    <View style={styles.insightCard}>
      <View style={styles.insightHeader}>
        <Sparkles color={colors.clay} size={17} strokeWidth={2} />
        <Text style={styles.insightEyebrow}>{insight.eyebrow}</Text>
      </View>
      <ScrollView
        style={styles.insightBodyScroll}
        contentContainerStyle={styles.insightBodyScrollContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        <Text style={styles.insightBody}>{insight.body}</Text>

        {sources.length > 0 && onNavigateSource ? (
          <View style={styles.insightSources}>
            <BookSources sources={sources} onNavigate={onNavigateSource} />
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.insightActions, styles.insightActionsWrapped]}>
        <Pressable
          accessibilityLabel="Show an example"
          accessibilityRole="button"
          onPress={onExample}
          style={[styles.secondaryButton, styles.secondaryButtonWrapped]}
        >
          <BookOpen color={colors.ink} size={16} strokeWidth={2} />
          <Text style={styles.secondaryButtonText}>Example</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onMakeSimpler}
          style={[styles.secondaryButton, styles.secondaryButtonWrapped]}
        >
          <SlidersHorizontal color={colors.ink} size={16} strokeWidth={2} />
          <Text style={styles.secondaryButtonText}>Simpler</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onAskMore}
          style={[styles.secondaryButton, styles.secondaryButtonWrapped]}
        >
          <MessageCircle color={colors.ink} size={16} strokeWidth={2} />
          <Text style={styles.secondaryButtonText}>Ask more</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isSaved}
          onPress={onSave}
          style={[
            styles.secondaryButton,
            styles.secondaryButtonWrapped,
            isSaved && styles.secondaryButtonSaved,
          ]}
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
  libraryScreen: {
    backgroundColor: colors.paper,
    flex: 1,
  },
  libraryHeader: {
    gap: 12,
    paddingBottom: 4,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  libraryTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  libraryTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 28,
  },
  libraryHeaderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  libraryAccountButton: {
    alignItems: 'center',
    borderColor: '#d0cbc1',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 6,
  },
  libraryScanButton: {
    alignItems: 'center',
    borderColor: '#d0cbc1',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 6,
  },
  libraryScanText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  scanProgressBanner: {
    alignItems: 'center',
    backgroundColor: '#eef4eb',
    borderBottomColor: colors.hairline,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 42,
    paddingHorizontal: 18,
  },
  scanProgressText: {
    color: colors.sageDark,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  libraryImportButton: {
    alignItems: 'center',
    backgroundColor: colors.sageDark,
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 6,
  },
  libraryImportText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  libraryList: {
    gap: 12,
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  libraryBookCard: {
    backgroundColor: colors.card,
    borderColor: colors.hairline,
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  libraryBookCardActive: {
    borderColor: colors.sageDark,
  },
  libraryBookTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 11,
  },
  libraryBookIcon: {
    alignItems: 'center',
    backgroundColor: '#edf3e9',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  libraryBookTitleBlock: {
    flex: 1,
  },
  libraryBookTitle: {
    color: colors.ink,
    fontFamily: readerFont,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 21,
  },
  libraryBookAuthor: {
    color: colors.mutedInk,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 17,
    marginTop: 2,
  },
  libraryDeleteButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  libraryBookMetaRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 11,
  },
  libraryBookMeta: {
    color: colors.mutedInk,
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 15,
  },
  libraryProgressTrack: {
    backgroundColor: '#d7d2c8',
    borderRadius: 999,
    height: 3,
    marginTop: 12,
    overflow: 'hidden',
  },
  libraryProgressFill: {
    backgroundColor: colors.sageDark,
    borderRadius: 999,
    height: 3,
  },
  libraryResumeButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: '#cfc8bb',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  libraryResumeButtonActive: {
    backgroundColor: colors.sageDark,
    borderColor: colors.sageDark,
  },
  libraryResumeText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  libraryResumeTextActive: {
    color: colors.white,
  },
  libraryResumeButtonFlex: {
    flex: 1,
  },
  libraryCardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 13,
  },
  libraryMindMapButton: {
    alignItems: 'center',
    borderColor: '#cfc8bb',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
  },
  libraryMindMapText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '600',
  },
  headerMindMapIcon: {
    fontSize: 19,
  },
  mapReturnChip: {
    alignItems: 'center',
    backgroundColor: '#ede8f7',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  mapReturnChipText: {
    color: '#7c5cbf',
    fontSize: 12,
    fontWeight: '700',
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
  insightBodyScroll: {
    maxHeight: 260,
  },
  insightBodyScrollContent: {
    paddingRight: 2,
  },
  insightBody: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 18,
  },
  insightSources: {
    borderTopColor: colors.warmNoteBorder,
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
  },
  errorText: {
    color: colors.error,
  },
  insightActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  insightActionsWrapped: {
    flexWrap: 'wrap',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    borderColor: '#6f6758',
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  secondaryButtonWrapped: {
    flexBasis: '45%',
    flexGrow: 1,
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
  askPill: {
    alignItems: 'center',
    backgroundColor: colors.sageDark,
    borderRadius: 20,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  askPillText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
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
  searchSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '68%',
    paddingBottom: 18,
    paddingHorizontal: 16,
    paddingTop: 9,
    shadowColor: colors.shadow,
    shadowOffset: { height: -8, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  searchInputRow: {
    alignItems: 'center',
    borderColor: '#d6d3cc',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  searchInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0,
    minHeight: 42,
    paddingVertical: 9,
  },
  searchScopeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  searchScopeButton: {
    alignItems: 'center',
    borderColor: '#d0cbc1',
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  searchScopeButtonActive: {
    backgroundColor: colors.sageDark,
    borderColor: colors.sageDark,
  },
  searchScopeText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  searchScopeTextActive: {
    color: colors.white,
  },
  searchResultsList: {
    maxHeight: 420,
    marginTop: 10,
  },
  searchResultItem: {
    borderBottomColor: colors.hairline,
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  searchResultMeta: {
    color: colors.sageDark,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 15,
    marginBottom: 5,
  },
  searchResultExcerpt: {
    color: colors.ink,
    fontFamily: readerFont,
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 20,
  },
  savedNotesSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '68%',
    paddingBottom: 18,
    paddingHorizontal: 16,
    paddingTop: 9,
    shadowColor: colors.shadow,
    shadowOffset: { height: -8, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  savedNotesHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  savedNotesCount: {
    color: colors.mutedInk,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 16,
  },
  savedNotesActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  savedNotesCopyButton: {
    alignItems: 'center',
    borderColor: '#d0cbc1',
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 11,
  },
  savedNotesCopyText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  savedNotesSearchRow: {
    alignItems: 'center',
    borderColor: '#d6d3cc',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 10,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  savedNotesSearchInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0,
    minHeight: 40,
    paddingVertical: 8,
  },
  savedNoteFilters: {
    gap: 8,
    paddingBottom: 10,
    paddingTop: 2,
  },
  savedNoteFilterButton: {
    borderColor: '#d0cbc1',
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 30,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  savedNoteFilterButtonActive: {
    backgroundColor: colors.sageDark,
    borderColor: colors.sageDark,
  },
  savedNoteFilterText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  savedNoteFilterTextActive: {
    color: colors.white,
  },
  savedNotesList: {
    maxHeight: 420,
  },
  savedNoteItem: {
    borderBottomColor: colors.hairline,
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  savedNoteHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  savedNoteEyebrow: {
    color: colors.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 17,
  },
  savedNoteAction: {
    color: colors.sageDark,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
  },
  savedNoteSource: {
    color: colors.sageDark,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 15,
    marginBottom: 5,
  },
  savedNoteActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  savedNoteIconButton: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  savedNoteSelection: {
    color: colors.mutedInk,
    fontFamily: readerFont,
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 18,
    marginBottom: 6,
  },
  savedNoteBody: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 18,
  },
  savedNoteUserNote: {
    backgroundColor: '#edf3e9',
    borderColor: '#d6e2d2',
    borderRadius: 7,
    borderWidth: 1,
    color: colors.sageDark,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 17,
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  emptyNotes: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    minHeight: 128,
    paddingHorizontal: 20,
  },
  emptyNotesText: {
    color: colors.mutedInk,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: 'center',
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
  threadKeyboardContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    width: '100%',
  },
  threadSheet: {
    flex: 1,
    width: '100%',
  },
  peekBar: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.hairline,
    borderRadius: 16,
    borderWidth: 1,
    bottom: 74,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: 'absolute',
    right: 12,
    shadowColor: colors.shadow,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
  },
  peekText: {
    color: '#3f3b34',
    fontSize: 13,
  },
  peekReopen: {
    color: colors.sageDark,
    fontSize: 13,
    fontWeight: '800',
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
  noteEditorSheet: {
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
  noteEditorHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  noteEditorCloseButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  noteEditorContext: {
    flexGrow: 0,
    marginBottom: 10,
    maxHeight: 260,
  },
  noteEditorContextCompact: {
    maxHeight: 132,
  },
  noteEditorContextContent: {
    paddingBottom: 2,
  },
  noteEditorQuestionInput: {
    borderColor: '#d6d3cc',
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 19,
    marginBottom: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  noteEditorAnswer: {
    backgroundColor: colors.warmNote,
    borderColor: colors.warmNoteBorder,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  noteEditorCitations: {
    marginTop: 10,
  },
  noteEditorSelection: {
    color: colors.mutedInk,
    fontFamily: readerFont,
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 18,
    marginBottom: 8,
  },
  noteEditorInput: {
    borderColor: '#d6d3cc',
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 19,
    minHeight: 98,
    paddingHorizontal: 11,
    paddingVertical: 10,
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
  askScopeRow: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 10,
  },
  askScopeButton: {
    alignItems: 'center',
    borderColor: '#d0cbc1',
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  askScopeButtonActive: {
    backgroundColor: colors.sageDark,
    borderColor: colors.sageDark,
  },
  askScopeText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
  },
  askScopeTextActive: {
    color: colors.white,
  },
  wholeBookToggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  wholeBookToggleLabel: {
    color: colors.mutedInk,
    fontSize: 12,
    fontWeight: '600',
  },
  wholeBookToggle: {
    backgroundColor: '#ccc',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    padding: 2,
    width: 44,
  },
  wholeBookToggleOn: {
    backgroundColor: colors.sageDark,
  },
  wholeBookToggleThumb: {
    backgroundColor: colors.white,
    borderRadius: 10,
    height: 20,
    width: 20,
  },
  wholeBookToggleThumbOn: {
    alignSelf: 'flex-end',
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
  primarySheetButton: {
    backgroundColor: colors.sageDark,
    borderColor: colors.sageDark,
  },
  sheetButtonText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  primarySheetButtonText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
