import type { DocumentPickerAsset } from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

type SelectionKind = 'word' | 'phrase' | 'paragraph';
export type EpubBlockKind =
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

export type EpubParagraph = {
  blockKind: EpubBlockKind;
  id: string;
  segments: PassageSegment[];
};

export type EpubChapter = {
  id: string;
  paragraphId: string;
  title: string;
};

export type ParsedEpubBook = {
  author: string;
  chapters: EpubChapter[];
  fileName: string;
  paragraphs: EpubParagraph[];
  title: string;
};

type SpineItem = {
  id: string;
  mediaType: string | null;
  path: string;
  properties: string;
  title: string | null;
};

type TocEntry = {
  fragment: string | null;
  path: string;
  title: string;
};

type ResolvedHrefTarget = {
  fragment: string | null;
  path: string;
};

type ContentBlock = {
  anchorIds: string[];
  blockKind: EpubBlockKind;
  isHeading: boolean;
  tagName: string;
  text: string;
};

type XmlObject = Record<string, unknown>;

type TitleTargets = Map<string, string[]>;

const xmlParser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  removeNSPrefix: true,
  textNodeName: '#text',
});

export async function parseEpubAsset(asset: DocumentPickerAsset): Promise<ParsedEpubBook> {
  assertEpubAsset(asset);

  const base64 = await readAssetAsBase64(asset);
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const opfPath = await readPackagePath(zip);
  const opfText = await readZipText(zip, opfPath);
  const opf = parseXmlObject(opfText);
  const packageNode = getObject(opf.package);

  if (!packageNode) {
    throw new Error('This EPUB is missing its package document.');
  }

  const manifestItems = readManifestItems(packageNode, opfPath);
  const title = readMetadataText(packageNode, 'title') ?? fileNameToTitle(asset.name);
  const author = readMetadataText(packageNode, 'creator') ?? 'Unknown author';
  const tocEntries = await readTocEntries(zip, packageNode, manifestItems);
  const spineItems = readSpineItems(packageNode, manifestItems).filter((item) => !isNavigationDocument(item));

  if (spineItems.length === 0) {
    throw new Error('This EPUB has no readable spine chapters.');
  }

  const chapters: EpubChapter[] = [];
  const paragraphs: EpubParagraph[] = [];
  const contentChapters: EpubChapter[] = [];
  const fallbackChapterSources: Array<{ paragraphId: string; title: string }> = [];
  const pathAndAnchorToParagraphId = new Map<string, string>();
  const pathToFirstParagraphId = new Map<string, string>();
  const titleToParagraphIds: TitleTargets = new Map();

  for (const spineItem of spineItems) {
    const html = await readZipText(zip, spineItem.path);
    const contentBlocks = extractContentBlocks(html);

    if (isNavigationContent(html, contentBlocks)) {
      continue;
    }

    const chapterParagraphs = buildParagraphs(contentBlocks, paragraphs.length);

    if (chapterParagraphs.length === 0) {
      continue;
    }

    pathToFirstParagraphId.set(spineItem.path, chapterParagraphs[0].id);
    contentBlocks.forEach((block, index) => {
      block.anchorIds.forEach((anchorId) => {
        pathAndAnchorToParagraphId.set(anchorKey(spineItem.path, anchorId), chapterParagraphs[index].id);
      });

      if (isChapterTitleCandidate(block)) {
        addTitleTarget(titleToParagraphIds, block.text, chapterParagraphs[index].id);
      }
    });
    contentChapters.push(...buildChaptersFromContent(contentBlocks, chapterParagraphs, contentChapters.length));
    fallbackChapterSources.push({
      paragraphId: chapterParagraphs[0].id,
      title: extractChapterTitle(html) ?? spineItem.title ?? `Chapter ${fallbackChapterSources.length + 1}`,
    });
    paragraphs.push(...chapterParagraphs);
  }

  if (paragraphs.length === 0) {
    throw new Error('No readable paragraphs were found in this EPUB.');
  }

  const tocChapters = buildChaptersFromToc(
    tocEntries,
    pathToFirstParagraphId,
    pathAndAnchorToParagraphId,
    titleToParagraphIds,
  );
  chapters.push(
    ...(tocChapters.length > 0
      ? tocChapters
      : contentChapters.length > 0
        ? contentChapters
        : buildFallbackChapters(fallbackChapterSources)),
  );

  return {
    author,
    chapters,
    fileName: asset.name,
    paragraphs,
    title,
  };
}

function assertEpubAsset(asset: DocumentPickerAsset) {
  const isEpubName = asset.name.toLowerCase().endsWith('.epub');
  const isEpubMime = asset.mimeType === 'application/epub+zip';

  if (!isEpubName && !isEpubMime) {
    throw new Error('Only EPUB import is available right now. PDF, image, and scan import will come with the OCR pipeline.');
  }
}

async function readAssetAsBase64(asset: DocumentPickerAsset) {
  if (asset.base64) {
    return stripDataUrlPrefix(asset.base64);
  }

  return FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

function stripDataUrlPrefix(value: string) {
  const base64Marker = ';base64,';
  const base64Start = value.indexOf(base64Marker);
  return base64Start >= 0 ? value.slice(base64Start + base64Marker.length) : value;
}

async function readPackagePath(zip: JSZip) {
  const containerText = await readZipText(zip, 'META-INF/container.xml');
  const container = parseXmlObject(containerText);
  const rootfiles = getObject(getObject(container.container)?.rootfiles);
  const rootfile = firstItem(rootfiles?.rootfile);
  const packagePath = getString(getObject(rootfile)?.['@_full-path']);

  if (!packagePath) {
    throw new Error('This EPUB is missing META-INF/container.xml package metadata.');
  }

  return packagePath;
}

async function readZipText(zip: JSZip, path: string) {
  const file = zip.file(path);

  if (!file) {
    throw new Error(`This EPUB is missing ${path}.`);
  }

  return file.async('text');
}

function parseXmlObject(xml: string): XmlObject {
  const parsed = xmlParser.parse(xml);

  if (!isObject(parsed)) {
    throw new Error('Could not parse EPUB XML metadata.');
  }

  return parsed;
}

function readMetadataText(packageNode: XmlObject, key: 'creator' | 'title') {
  const metadata = getObject(packageNode.metadata);
  return cleanInlineText(readXmlText(firstItem(metadata?.[key]) ?? null));
}

function readManifestItems(packageNode: XmlObject, opfPath: string): SpineItem[] {
  const manifest = getObject(packageNode.manifest);
  return asArray(manifest?.item)
    .map((item) => getObject(item))
    .filter((item): item is XmlObject => item !== null)
    .map((item) => {
      const id = getString(item['@_id']);
      const href = getString(item['@_href']);

      if (!id || !href) {
        return null;
      }

      return {
        id,
        mediaType: getString(item['@_media-type']),
        path: resolveZipPath(dirname(opfPath), href),
        properties: getString(item['@_properties']) ?? '',
        title: idToTitle(id),
      };
    })
    .filter((item): item is SpineItem => item !== null);
}

function readSpineItems(packageNode: XmlObject, manifestItems: SpineItem[]): SpineItem[] {
  const spine = getObject(packageNode.spine);
  const manifestById = new Map(manifestItems.map((item) => [item.id, item]));

  return asArray(spine?.itemref)
    .map((itemref) => {
      const idref = getString(getObject(itemref)?.['@_idref']);
      return idref ? manifestById.get(idref) ?? null : null;
    })
    .filter((item): item is SpineItem => item !== null);
}

async function readTocEntries(
  zip: JSZip,
  packageNode: XmlObject,
  manifestItems: SpineItem[],
): Promise<TocEntry[]> {
  const navItem = manifestItems.find((item) => item.properties.split(/\s+/).includes('nav'));

  if (navItem) {
    return extractNavTocEntries(await readZipText(zip, navItem.path), navItem.path);
  }

  const ncxId = getString(getObject(packageNode.spine)?.['@_toc']);
  const ncxItem =
    (ncxId ? manifestItems.find((item) => item.id === ncxId) : null) ??
    manifestItems.find((item) => item.mediaType === 'application/x-dtbncx+xml');

  if (ncxItem) {
    return extractNcxTocEntries(await readZipText(zip, ncxItem.path), ncxItem.path);
  }

  const fallbackNavItem = manifestItems.find((item) => isNavigationDocument(item));
  return fallbackNavItem ? extractNavTocEntries(await readZipText(zip, fallbackNavItem.path), fallbackNavItem.path) : [];
}

function extractNavTocEntries(html: string, navPath: string): TocEntry[] {
  const navBlocks = Array.from(html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)).map((match) => match[0]);
  const tocBlock =
    navBlocks.find((block) => /(?:epub:)?type=["'][^"']*\btoc\b/i.test(block) || /role=["']doc-toc["']/i.test(block)) ??
    navBlocks[0] ??
    html;

  return dedupeTocEntries(
    Array.from(tocBlock.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))
      .map((match) => {
        const target = resolveHrefTarget(navPath, match[1]);

        return {
          fragment: target.fragment,
          path: target.path,
          title: htmlToPlainText(match[2]) ?? '',
        };
      })
      .filter((entry) => entry.title.length > 0),
  );
}

function extractNcxTocEntries(ncxText: string, ncxPath: string): TocEntry[] {
  const ncx = parseXmlObject(ncxText);
  const navMap = getObject(getObject(ncx.ncx)?.navMap);

  function visitNavPoint(value: unknown): TocEntry[] {
    return asArray(value).flatMap((candidate) => {
      const navPoint = getObject(candidate);

      if (!navPoint) {
        return [];
      }

      const title = cleanInlineText(readXmlText(getObject(firstItem(navPoint.navLabel))?.text));
      const src = getString(getObject(firstItem(navPoint.content))?.['@_src']);
      const target = src ? resolveHrefTarget(ncxPath, src) : null;
      const currentEntry =
        title && target
          ? [
              {
                fragment: target.fragment,
                path: target.path,
                title,
              },
            ]
          : [];

      return [...currentEntry, ...visitNavPoint(navPoint.navPoint)];
    });
  }

  return dedupeTocEntries(visitNavPoint(navMap?.navPoint));
}

function buildChaptersFromToc(
  entries: TocEntry[],
  pathToFirstParagraphId: Map<string, string>,
  pathAndAnchorToParagraphId: Map<string, string>,
  titleToParagraphIds: TitleTargets,
): EpubChapter[] {
  const seenParagraphIds = new Set<string>();

  return entries
    .map((entry) => {
      const paragraphId = resolveTocParagraphId(
        entry,
        pathToFirstParagraphId,
        pathAndAnchorToParagraphId,
        titleToParagraphIds,
      );

      if (
        !paragraphId ||
        seenParagraphIds.has(paragraphId) ||
        isNavigationPath(entry.path) ||
        isNavigationTitle(entry.title)
      ) {
        return null;
      }

      seenParagraphIds.add(paragraphId);

      return {
        id: `chapter-${seenParagraphIds.size}`,
        paragraphId,
        title: entry.title,
      };
    })
    .filter((chapter): chapter is EpubChapter => chapter !== null);
}

function resolveTocParagraphId(
  entry: TocEntry,
  pathToFirstParagraphId: Map<string, string>,
  pathAndAnchorToParagraphId: Map<string, string>,
  titleToParagraphIds: TitleTargets,
) {
  if (entry.fragment) {
    const anchorParagraphId = pathAndAnchorToParagraphId.get(anchorKey(entry.path, entry.fragment));

    if (anchorParagraphId) {
      return anchorParagraphId;
    }
  }

  return findTitleTarget(titleToParagraphIds, entry.title) ?? pathToFirstParagraphId.get(entry.path) ?? null;
}

function buildFallbackChapters(sources: Array<{ paragraphId: string; title: string }>): EpubChapter[] {
  return sources.map((source, index) => ({
    id: `chapter-${index + 1}`,
    paragraphId: source.paragraphId,
    title: source.title,
  }));
}

function buildChaptersFromContent(
  contentBlocks: ContentBlock[],
  paragraphs: EpubParagraph[],
  startIndex: number,
): EpubChapter[] {
  return contentBlocks
    .map((block, index) => {
      if (!isChapterTitleCandidate(block) || isNavigationTitle(block.text)) {
        return null;
      }

      return {
        id: `content-chapter-${startIndex + index + 1}`,
        paragraphId: paragraphs[index].id,
        title: block.text,
      };
    })
    .filter((chapter): chapter is EpubChapter => chapter !== null);
}

function extractContentBlocks(html: string): ContentBlock[] {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const withoutScripts = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const primaryBlocks = readHtmlBlocks(withoutScripts, /<(h[1-6]|p|li|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/gi);
  const rawBlocks =
    primaryBlocks.length > 0 ? primaryBlocks : readHtmlBlocks(withoutScripts, /<(div)\b([^>]*)>([\s\S]*?)<\/div>/gi);
  const contentBlocksWithoutKinds: ContentBlock[] = [];
  let pendingAnchorIds: string[] = [];

  rawBlocks.forEach((block) => {
    const text = htmlToPlainText(block.html);
    const anchorIds = uniqueStrings([...pendingAnchorIds, ...block.anchorIds]);

    if (!text || (!block.isHeading && text.length < 12)) {
      pendingAnchorIds = anchorIds;
      return;
    }

    contentBlocksWithoutKinds.push({
      anchorIds,
      blockKind: 'body',
      isHeading: block.isHeading,
      tagName: block.tagName,
      text,
    });
    pendingAnchorIds = [];
  });

  return applyReaderBlockKinds(contentBlocksWithoutKinds);
}

function applyReaderBlockKinds(contentBlocks: ContentBlock[]): ContentBlock[] {
  return contentBlocks.map((block, index) => ({
    ...block,
    blockKind: inferReaderBlockKind(block, contentBlocks[index - 1] ?? null, contentBlocks[index + 1] ?? null),
  }));
}

function inferReaderBlockKind(
  block: ContentBlock,
  previousBlock: ContentBlock | null,
  nextBlock: ContentBlock | null,
): EpubBlockKind {
  const text = block.text.trim();

  if (isChapterNumberText(text)) {
    return 'chapterNumber';
  }

  if (previousBlock && isChapterNumberText(previousBlock.text) && isHeadingLikeText(text)) {
    return 'chapterTitle';
  }

  if (block.tagName === 'blockquote') {
    return 'quote';
  }

  if (block.tagName === 'li') {
    return 'listItem';
  }

  if (block.isHeading) {
    return block.tagName === 'h1' ? 'chapterTitle' : 'sectionHeading';
  }

  if (isAllCapsHeading(text)) {
    return 'sectionHeading';
  }

  if (isShortSubheading(text, nextBlock)) {
    return 'subheading';
  }

  return 'body';
}

function readHtmlBlocks(
  html: string,
  blockPattern: RegExp,
): Array<{ anchorIds: string[]; html: string; isHeading: boolean; tagName: string }> {
  const blocks: Array<{ anchorIds: string[]; html: string; isHeading: boolean; tagName: string }> = [];
  let previousEnd = 0;

  Array.from(html.matchAll(blockPattern)).forEach((match) => {
    const tagName = match[1].toLowerCase();
    const openingAttributes = match[2] ?? '';
    const innerHtml = match[3] ?? '';
    const fullHtml = match[0];
    const pendingAnchorHtml = html.slice(previousEnd, match.index ?? previousEnd);
    const anchorIds = uniqueStrings([
      ...extractAnchorIds(pendingAnchorHtml),
      ...extractAnchorIds(openingAttributes),
      ...extractAnchorIds(innerHtml),
    ]);

    blocks.push({
      anchorIds,
      html: fullHtml,
      isHeading: /^h[1-6]$/.test(tagName),
      tagName,
    });
    previousEnd = (match.index ?? previousEnd) + fullHtml.length;
  });

  return blocks;
}

function isNavigationDocument(item: SpineItem) {
  return (
    item.properties.split(/\s+/).includes('nav') ||
    item.mediaType === 'application/x-dtbncx+xml' ||
    isNavigationPath(item.path) ||
    isNavigationPath(item.id)
  );
}

function isNavigationContent(html: string, contentBlocks: ContentBlock[]) {
  const title = extractChapterTitle(html);
  const firstParagraph = contentBlocks[0]?.text ?? '';
  return Boolean((title && isNavigationTitle(title)) || isNavigationTitle(firstParagraph));
}

function isNavigationPath(value: string) {
  return /(^|[/_-])(toc|contents?|nav|navigation)([/_.-]|$)/i.test(value);
}

function isNavigationTitle(value: string) {
  return /^(table of contents|contents|toc|cover|title page|copyright)$/i.test(value.trim());
}

function dedupeTocEntries(entries: TocEntry[]) {
  const seenEntries = new Set<string>();

  return entries.filter((entry) => {
    const key = `${entry.path}#${entry.fragment ?? ''}:${normalizeTitleKey(entry.title)}`;

    if (seenEntries.has(key)) {
      return false;
    }

    seenEntries.add(key);
    return true;
  });
}

function extractChapterTitle(html: string) {
  const titleCandidate =
    html.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] ??
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  return titleCandidate ? htmlToPlainText(titleCandidate) : null;
}

function htmlToPlainText(html: string) {
  return cleanInlineText(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

function buildParagraphs(contentBlocks: ContentBlock[], startIndex: number): EpubParagraph[] {
  return contentBlocks.map((block, index) => {
    const paragraphId = `epub-p-${startIndex + index + 1}`;

    return {
      blockKind: block.blockKind,
      id: paragraphId,
      segments: [
        {
          id: `${paragraphId}-text`,
          paragraphId,
          selectionKind: 'paragraph',
          text: block.text,
        },
      ],
    };
  });
}

function addTitleTarget(titleToParagraphIds: TitleTargets, title: string, paragraphId: string) {
  const key = normalizeTitleKey(title);

  if (!key) {
    return;
  }

  const currentIds = titleToParagraphIds.get(key) ?? [];
  titleToParagraphIds.set(key, [...currentIds, paragraphId]);
}

function findTitleTarget(titleToParagraphIds: TitleTargets, title: string) {
  return titleToParagraphIds.get(normalizeTitleKey(title))?.[0] ?? null;
}

function isChapterTitleCandidate(block: ContentBlock) {
  const text = block.text.trim();

  return (
    block.blockKind === 'chapterNumber' ||
    block.blockKind === 'chapterTitle' ||
    block.blockKind === 'sectionHeading' ||
    block.blockKind === 'subheading' ||
    /^(chapter|part|section|lesson|introduction|preface|acknowledg|conclusion|appendix)\b/i.test(text) ||
    (text.length <= 120 && text === text.toUpperCase() && /[A-Z]/.test(text))
  );
}

function isChapterNumberText(text: string) {
  return /^(chapter|part|book)\s+[\divxlcdm]+(?:\b|$)/i.test(text.trim()) && text.trim().length <= 70;
}

function isHeadingLikeText(text: string) {
  return isAllCapsHeading(text) || isShortSubheading(text, null);
}

function isAllCapsHeading(text: string) {
  const trimmedText = text.trim();

  return (
    trimmedText.length >= 3 &&
    trimmedText.length <= 140 &&
    trimmedText === trimmedText.toUpperCase() &&
    /[A-Z]/.test(trimmedText) &&
    trimmedText.split(/\s+/).length <= 14
  );
}

function isShortSubheading(text: string, nextBlock: ContentBlock | null) {
  const trimmedText = text.trim();

  if (
    trimmedText.length > 80 ||
    trimmedText.split(/\s+/).length > 9 ||
    /[.!?;:]$/.test(trimmedText) ||
    isNavigationTitle(trimmedText)
  ) {
    return false;
  }

  return Boolean(nextBlock && nextBlock.text.length >= 40);
}

function extractAnchorIds(html: string) {
  return Array.from(html.matchAll(/\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi))
    .map((match) => decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? '').trim())
    .filter((id) => id.length > 0);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function anchorKey(path: string, anchorId: string) {
  return `${path}#${anchorId}`;
}

function normalizeTitleKey(value: string) {
  return cleanInlineText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
}

function readXmlText(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  const objectValue = getObject(value);

  if (!objectValue) {
    return null;
  }

  return readXmlText(objectValue['#text']);
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    nbsp: ' ',
    quot: '"',
    lt: '<',
  };

  return value
    .replace(/&#(\d+);/g, (_, codePoint: string) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([\da-f]+);/gi, (_, codePoint: string) => String.fromCodePoint(parseInt(codePoint, 16)))
    .replace(/&([a-z]+);/gi, (match, entity: string) => namedEntities[entity.toLowerCase()] ?? match);
}

function cleanInlineText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? null;
}

function fileNameToTitle(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported book';
}

function idToTitle(id: string) {
  const cleaned = id.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? sentenceCase(cleaned) : null;
}

function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dirname(path: string) {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex >= 0 ? path.slice(0, slashIndex) : '';
}

function resolveHrefTarget(sourcePath: string, href: string): ResolvedHrefTarget {
  const hashIndex = href.indexOf('#');
  const hrefPath = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const rawFragment = hashIndex >= 0 ? href.slice(hashIndex + 1) : '';

  return {
    fragment: rawFragment ? decodeUriComponentSafe(rawFragment) : null,
    path: hrefPath ? resolveZipPath(dirname(sourcePath), hrefPath) : sourcePath,
  };
}

function resolveZipPath(baseDir: string, href: string) {
  const cleanedHref = href.split('#')[0];
  const parts = `${baseDir}/${cleanedHref}`.split('/');
  const resolvedParts: string[] = [];

  parts.forEach((part) => {
    if (!part || part === '.') {
      return;
    }

    if (part === '..') {
      resolvedParts.pop();
      return;
    }

    resolvedParts.push(part);
  });

  return decodeUriComponentSafe(resolvedParts.join('/'));
}

function decodeUriComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined || value === null ? [] : [value];
}

function firstItem(value: unknown) {
  return asArray(value)[0] ?? null;
}

function getObject(value: unknown): XmlObject | null {
  return isObject(value) ? value : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isObject(value: unknown): value is XmlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
