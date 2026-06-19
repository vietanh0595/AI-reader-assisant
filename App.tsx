import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import type { DocumentPickerAsset } from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
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
  Library as LibraryIcon,
  List,
  LogIn,
  LogOut,
  LucideProps,
  MessageCircle,
  Pencil,
  Search,
  Send,
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
import { BookSources } from './src/components/BookSources';
import { ConversationThread } from './src/components/ConversationThread';
import { SignInSheet } from './src/components/SignInSheet';
import { WholeBookAiSheet } from './src/components/WholeBookAiSheet';
import type { BookSource } from './src/rag/bookAskTypes';
import { requestBookAsk } from './src/rag/bookAskApi';
import { buildHistory } from './src/rag/buildHistory';
import { createIndexApi } from './src/rag/indexApi';
import { indexBook } from './src/rag/indexBook';
import type { WholeBookAiState } from './src/rag/types';
import { type ConversationTurn, LIBRARY_SCHEMA_VERSION, migrateLibraryItem } from './src/library/conversation';
import { appendTurns } from './src/library/appendTurn';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { parseEpubAsset, ParsedEpubBook } from './epub';

type QuickAction = 'explain' | 'example' | 'rephrase' | 'ask';
type ClipboardAction = 'copy';
type SelectionAction = QuickAction | ClipboardAction;
type FollowUpAction = 'simpler';
type SummaryAction = 'summarize';
type InsightAction = QuickAction | FollowUpAction | SummaryAction;
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

type SavedInsight = {
  action: InsightAction;
  body: string;
  bookTitle: string;
  createdAt: string;
  eyebrow: string;
  id: string;
  paragraphId: string;
  selectedText: string;
  selectionKind: SelectionKind;
  sourceRef?: DocumentSourceRef;
  updatedAt?: string;
  userNote?: string;
};

type SavedNoteFilter = 'all' | InsightAction;

type LibraryItem = {
  book: ReaderBook;
  conversation: ConversationTurn[];
  id: string;
  importedAt: string;
  lastOpenedAt: string;
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
  outline: Array<{ pageIndex: number; title: string }>;
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

  const outlineChapters = pdfResult.outline
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
      const searchableFields = [
        note.selectedText,
        note.body,
        note.userNote ?? '',
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

function formatSavedInsightsForExport(readerBook: ReaderBook, savedInsights: SavedInsight[]) {
  const sortedNotes = [...savedInsights].sort((firstNote, secondNote) =>
    firstNote.createdAt.localeCompare(secondNote.createdAt),
  );
  const header = `${readerBook.title}\n${readerBook.author}\nSaved notes`;
  const body = sortedNotes.map(formatSavedInsightForExport).join('\n\n');

  return body ? `${header}\n\n${body}` : header;
}

function formatSavedInsightForExport(note: SavedInsight, index: number) {
  const lines = [
    `${index + 1}. ${getInsightActionLabel(note.action)} - ${formatSavedNoteDate(note.createdAt)}`,
    `Selected: ${normalizeSelectionText(note.selectedText)}`,
    `AI: ${normalizeSelectionText(note.body)}`,
  ];
  const sourceLabel = formatSourceRef(note.sourceRef);
  const userNote = normalizeSelectionText(note.userNote ?? '');

  if (sourceLabel) {
    lines.splice(1, 0, `Source: ${sourceLabel}`);
  }

  if (userNote) {
    lines.push(`Note: ${userNote}`);
  }

  return lines.join('\n');
}

function formatSavedNoteDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function createSavedInsightId(selection: ReaderSelection, action: InsightAction, insight: Insight) {
  return `insight:${hashString(
    [selection.paragraphId, normalizeSelectionText(selection.text), action, insight.body].join('\n'),
  )}`;
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
    const libraryItems = value.libraryItems.filter(isLibraryItem).map((item) => migrateLibraryItem(hydrateLibraryItem(item)));

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

function isLibraryItem(value: unknown): value is LibraryItem {
  if (!isRecord(value) || !isReaderBook(value.book) || typeof value.id !== 'string') {
    return false;
  }

  const savedInsights = Array.isArray(value.savedInsights) && value.savedInsights.every(isSavedInsight);

  return (
    typeof value.importedAt === 'string' &&
    typeof value.lastOpenedAt === 'string' &&
    (value.readingLocation === null || isReadingLocation(value.readingLocation)) &&
    savedInsights
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
    typeof value.createdAt === 'string' &&
    typeof value.eyebrow === 'string' &&
    typeof value.id === 'string' &&
    typeof value.paragraphId === 'string' &&
    typeof value.selectedText === 'string' &&
    (value.selectionKind === 'word' || value.selectionKind === 'phrase' || value.selectionKind === 'paragraph') &&
    (value.sourceRef === undefined || isDocumentSourceRef(value.sourceRef)) &&
    (value.updatedAt === undefined || typeof value.updatedAt === 'string') &&
    (value.userNote === undefined || typeof value.userNote === 'string')
  );
}

function isInsightAction(value: unknown): value is InsightAction {
  return (
    value === 'explain' ||
    value === 'example' ||
    value === 'rephrase' ||
    value === 'ask' ||
    value === 'simpler' ||
    value === 'summarize'
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

async function requestOcr(payload: OcrRequestPayload): Promise<OcrExtractResponse> {
  const ocrUrl = `${apiBaseUrl}/ocr/extract`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ocrRequestTimeoutMs);
  const requestStartedAt = Date.now();
  let response: Response;

  try {
    response = await fetch(ocrUrl, {
      body: JSON.stringify(payload),
      headers: {
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
  const { error: authError, getAccessToken, isAuthenticated, isLoading: isAuthLoading, signIn, signOut } = useAuth();
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [isAssistLoading, setIsAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [copiedSelectionId, setCopiedSelectionId] = useState<string | null>(null);
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
  const [notesCopyFeedback, setNotesCopyFeedback] = useState(false);
  const assistRequestId = useRef(0);
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesCopyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScanningDocument = scanStage !== 'idle';
  const scanStageLabel = getScanStageLabel(scanStage);
  const activeLibraryItem = useMemo(
    () => getActiveLibraryItem(libraryItems, activeBookId),
    [activeBookId, libraryItems],
  );
  const currentBook = activeLibraryItem.book;
  const readingLocation = activeLibraryItem.readingLocation;
  const savedInsights = activeLibraryItem.savedInsights;
  const readerHtml = useMemo(() => createReaderHtml(currentBook.paragraphs), [currentBook.paragraphs]);

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
      setLibraryItems((items) =>
        items.map((item) =>
          item.id === bookId
            ? { ...item, wholeBookAi: { ...item.wholeBookAi, status: 'deleting' } }
            : item,
        ),
      );

      const token = await getAccessToken();
      let ok = false;
      if (token) {
        try {
          const resp = await fetch(`${apiBaseUrl}/library/books/${cloudBookId}/index`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          ok = resp.ok || resp.status === 404;
        } catch {
          ok = false;
        }
      }

      if (!ok) {
        // Revert to previous state so the user can retry (covers auth expiry too).
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
      eyebrow: savedInsight.eyebrow,
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

  function chooseAction(action: SelectionAction) {
    if (action === 'copy') {
      void copySelectionToClipboard();
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
      if (activeLibraryItem.wholeBookAi.status !== 'ready') {
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
        ocrResult = await requestOcr({ imageDataUrl: preparedImage.dataUrl });
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

  function startEditingSavedInsight(note: SavedInsight) {
    setEditingNote(note);
    setEditingNoteText(note.userNote ?? '');
  }

  function cancelEditingSavedInsight() {
    setEditingNote(null);
    setEditingNoteText('');
  }

  function saveEditedSavedInsight() {
    if (!editingNote) {
      return;
    }

    const trimmedNote = editingNoteText.trim();
    const updatedAt = new Date().toISOString();

    updateActiveLibraryItem((item) => ({
      ...item,
      lastOpenedAt: updatedAt,
      savedInsights: item.savedInsights.map((savedInsight) =>
        savedInsight.id === editingNote.id
          ? {
              ...savedInsight,
              updatedAt,
              userNote: trimmedNote || undefined,
            }
          : savedInsight,
      ),
    }));
    setEditingNote(null);
    setEditingNoteText('');
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

  function navigateToSource(paragraphId: string, excerpt?: string) {
    setIsThreadCollapsed(true);
    updateReadingLocation(paragraphId);
    setScrollTarget({ nonce: Date.now(), paragraphId, excerpt });
  }

  function openConversationThread() {
    if (activeLibraryItem.wholeBookAi.status !== 'ready') {
      setIsWholeBookAiOpen(true);
      return;
    }
    setIsAskOpen(false);
    setIsThreadCollapsed(false);
    setIsThreadOpen(true);
  }

  function clearConversation() {
    updateActiveLibraryItem((item) => ({ ...item, conversation: [] }));
  }

  async function runBookAsk(questionText: string) {
    const cloudBookId = activeLibraryItem.wholeBookAi.cloudBookId;

    if (!cloudBookId) {
      setAssistError('Whole-Book AI is not enabled for this book.');
      return;
    }

    const token = await getAccessToken();

    if (!token) {
      setAssistError('Sign in is required to use Book scope.');
      return;
    }

    const paragraphId = readingLocation?.paragraphId ?? currentBook.paragraphs[0]?.id ?? '';
    const readingOrder = Math.max(0, getParagraphIndex(paragraphId, currentBook.paragraphs));
    const requestId = assistRequestId.current + 1;
    assistRequestId.current = requestId;

    setSelectedAction('ask');
    setInsight(null);
    setAssistError(null);
    setIsAssistLoading(true);

    try {
      const result = await requestBookAsk({
        apiBaseUrl,
        cloudBookId,
        question: questionText,
        currentParagraphId: paragraphId,
        currentReadingOrder: readingOrder,
        includeWholeBook,
        accessToken: token,
        history: buildHistory(activeLibraryItem.conversation),
        selectedText: (selection ?? contextSelection)?.text ?? undefined,
      });

      if (assistRequestId.current === requestId) {
        setInsight({ body: result.body, eyebrow: result.eyebrow });
        setBookAskSources(result.sources);
        updateActiveLibraryItem((item) => ({
          ...item,
          conversation: appendTurns(
            item.conversation,
            { role: 'user', text: questionText },
            { role: 'assistant', text: result.body, sources: result.sources },
          ),
        }));
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

  async function runIndexBook() {
    const token = await getAccessToken();
    if (!token) {
      // Close the Book AI sheet first so the sign-in prompt isn't hidden behind it.
      setIsWholeBookAiOpen(false);
      setIsSignInOpen(true);
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

    const bookParagraphs = currentBook.paragraphs.map((p) => ({
      id: p.id,
      blockKind: (p.blockKind ?? 'body') as import('./src/rag/types').UploadBlock['blockKind'],
      text: p.segments.map((s) => s.text).join(''),
      sourceRef: p.sourceRef ?? { source: currentBook.source === 'sample' ? 'epub' : (currentBook.source as import('./src/rag/types').DocumentSource) },
      chapterId: undefined as string | undefined,
      chapterTitle: undefined as string | undefined,
    }));

    // Annotate each paragraph with its chapter
    let chapterIdx = 0;
    for (let i = 0; i < bookParagraphs.length; i++) {
      while (
        chapterIdx + 1 < currentBook.chapters.length &&
        currentBook.paragraphs.findIndex((p) => p.id === currentBook.chapters[chapterIdx + 1].paragraphId) <= i
      ) {
        chapterIdx++;
      }
      const chapter = currentBook.chapters[chapterIdx];
      if (chapter) {
        bookParagraphs[i].chapterId = chapter.id;
        bookParagraphs[i].chapterTitle = chapter.title;
      }
    }

    const activeId = activeLibraryItem.id;
    setLibraryItems((items) =>
      items.map((item) =>
        item.id === activeId
          ? { ...item, wholeBookAi: { ...item.wholeBookAi, status: 'uploading', error: undefined } }
          : item,
      ),
    );
    // Keep the sheet open so the user sees Uploading → Indexing → Ready progress.

    try {
      const nextState = await indexBook({
        api,
        book: {
          paragraphs: bookParagraphs,
          title: currentBook.title,
          author: currentBook.author,
          source: currentBook.source === 'sample' ? 'epub' : (currentBook.source as 'epub' | 'pdf' | 'scan'),
          clientBookId: activeLibraryItem.id,
          fileName: currentBook.fileName,
        },
        localState: activeLibraryItem.wholeBookAi.cloudBookId ? activeLibraryItem.wholeBookAi : null,
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
          item.id === activeId ? { ...item, wholeBookAi: nextState } : item,
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
            ? { ...item, wholeBookAi: { ...item.wholeBookAi, status: 'failed', error: message } }
            : item,
        ),
      );
    }
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
              onScanDocument={scanDocumentPage}
              onSignIn={() => setIsSignInOpen(true)}
              onSignOut={signOut}
              scanStageLabel={scanStageLabel}
            />
          ) : (
            <View style={styles.readerScreen}>
              <ReaderHeader
                book={currentBook}
                isImportingBook={isImportingBook}
                isScanningDocument={isScanningDocument}
                onImportBook={importBook}
                onOpenLibrary={openLibrary}
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
                        onSubmit={(text) => {
                          setIsThreadCollapsed(false);
                          void runBookAsk(text);
                        }}
                        onToggleWholeBook={() => setIncludeWholeBook((value) => !value)}
                        onClear={clearConversation}
                        onNavigateSource={navigateToSource}
                        onClearSelection={clearSelection}
                        onClose={() => setIsThreadOpen(false)}
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
                  notes={savedInsights}
                  onClose={() => {
                    setIsSavedNotesOpen(false);
                    cancelEditingSavedInsight();
                  }}
                  onCopyNotes={() => void copySavedInsightsToClipboard()}
                  onDeleteNote={deleteSavedInsight}
                  onEditNote={startEditingSavedInsight}
                  onSearchNotes={setNoteSearchQuery}
                  onSelectNote={openSavedInsight}
                  searchQuery={noteSearchQuery}
                />
              ) : null}

              {editingNote ? (
                <SavedNoteEditorSheet
                  note={editingNote}
                  noteText={editingNoteText}
                  onChangeNoteText={setEditingNoteText}
                  onClose={cancelEditingSavedInsight}
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
          onClose={() => setIsWholeBookAiOpen(false)}
          onEnable={() => { void runIndexBook(); }}
          onRetry={() => { void runIndexBook(); }}
        />
      ) : null}

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
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="Sign in"
              accessibilityRole="button"
              onPress={onSignIn}
              style={styles.libraryAccountButton}
            >
              <LogIn color={colors.ink} size={18} strokeWidth={2} />
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

              <Pressable
                accessibilityLabel={`Resume ${item.book.title}`}
                accessibilityRole="button"
                onPress={() => onOpenBook(item.id)}
                style={({ pressed }) => [
                  styles.libraryResumeButton,
                  isActive && styles.libraryResumeButtonActive,
                  pressed && styles.pressed,
                ]}
              >
                <BookOpen color={isActive ? colors.white : colors.ink} size={17} strokeWidth={2} />
                <Text style={[styles.libraryResumeText, isActive && styles.libraryResumeTextActive]}>
                  {isActive ? 'Resume current' : 'Resume'}
                </Text>
              </Pressable>
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
  isImportingBook,
  isScanningDocument,
  onImportBook,
  onOpenLibrary,
  onScanDocument,
}: {
  book: ReaderBook;
  isImportingBook: boolean;
  isScanningDocument: boolean;
  onImportBook: () => void;
  onOpenLibrary: () => void;
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
  notes,
  onClose,
  onCopyNotes,
  onDeleteNote,
  onEditNote,
  onSearchNotes,
  onSelectNote,
  searchQuery,
}: {
  copyFeedback: boolean;
  notes: SavedInsight[];
  onClose: () => void;
  onCopyNotes: () => void;
  onDeleteNote: (noteId: string) => void;
  onEditNote: (note: SavedInsight) => void;
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
            <Text style={styles.emptyNotesText}>Saved explanations will appear here.</Text>
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
                      {note.eyebrow}
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
                  <Text numberOfLines={2} style={styles.savedNoteSelection}>
                    {note.selectedText}
                  </Text>
                  <Text numberOfLines={3} style={styles.savedNoteBody}>
                    {note.body}
                  </Text>
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
  return [
    note.selectedText,
    note.body,
    note.userNote ?? '',
    note.eyebrow,
    getInsightActionLabel(note.action),
  ].some((value) => normalizeSelectionText(value).toLowerCase().includes(normalizedQuery));
}

function SavedNoteEditorSheet({
  note,
  noteText,
  onChangeNoteText,
  onClose,
  onSave,
}: {
  note: SavedInsight;
  noteText: string;
  onChangeNoteText: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const canSave = noteText.trim() !== (note.userNote ?? '').trim();
  const sourceLabel = formatSourceRef(note.sourceRef);

  return (
    <View style={styles.sheetLayer}>
      <Pressable accessibilityRole="button" style={styles.sheetScrim} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <View style={styles.noteEditorSheet}>
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
          <Text numberOfLines={2} style={styles.savedNoteSelection}>
            {note.selectedText}
          </Text>
          <Text numberOfLines={3} style={styles.noteEditorSource}>
            {note.body}
          </Text>
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
              <Text style={styles.sheetButtonText}>Cancel</Text>
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
      </KeyboardAvoidingView>
    </View>
  );
}

function getSavedNoteFilterOptions(notes: SavedInsight[]): SavedNoteFilter[] {
  const filterOptions: SavedNoteFilter[] = ['all'];

  for (const action of ['summarize', 'explain', 'ask', 'example', 'rephrase', 'simpler'] as InsightAction[]) {
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

  return (
    <View style={styles.sheetLayer}>
      <Pressable accessibilityRole="button" style={styles.sheetScrim} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <View style={styles.searchSheet}>
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
      </KeyboardAvoidingView>
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
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 82,
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
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  libraryAccountButton: {
    alignItems: 'center',
    borderColor: '#d0cbc1',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 11,
  },
  libraryScanButton: {
    alignItems: 'center',
    borderColor: '#d0cbc1',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 11,
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
    flexDirection: 'row',
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 12,
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
    marginTop: 13,
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
  noteEditorSource: {
    backgroundColor: colors.warmNote,
    borderColor: colors.warmNoteBorder,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 18,
    marginBottom: 10,
    padding: 10,
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
