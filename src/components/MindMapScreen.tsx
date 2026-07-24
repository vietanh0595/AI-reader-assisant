import React, { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { ReactNativeZoomableView } from "@openspacelabs/react-native-zoomable-view";
import Svg, { Defs, Marker, Path, Polygon } from "react-native-svg";
import {
  MindMapChapter,
  MindMapData,
  MindMapNode,
  MindMapNodeType,
  MindMapStatus,
} from "../rag/mindmapTypes";
import { NodeTapSheet } from "./NodeTapSheet";
import { ChapterTapSheet } from "./ChapterTapSheet";

// ─── Colors ───────────────────────────────────────────────────────────────────

const NODE_COLORS: Record<MindMapNodeType, string> = {
  theme: "#c8aaec",
  concept: "#a8d8d0",
  argument: "#f5c9a0",
  character: "#f2a8b0",
};
const NODE_TEXT_COLORS: Record<MindMapNodeType, string> = {
  theme: "#3d2b6e",
  concept: "#1a5050",
  argument: "#7a3f10",
  character: "#6e1a26",
};
const CENTER_COLOR = "#244f38";

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.5;

// ─── Geometry ─────────────────────────────────────────────────────────────────
// A fixed-size square canvas sized tightly around the map (independent of the
// screen) with generous, absolute spacing so nodes never overlap. The canvas is
// wrapped in <ReactNativeZoomableView>, which handles all pan/zoom/centering.

const R1 = 178; // inner ring radius — wide enough to space 8 nodes
const R2 = 293; // outer ring radius (R1 + radial gap)
const L2_REACH = 56; // half-extent of an outer node beyond its centre
const CANVAS_PAD = 30;
const CANVAS_SIZE = (R2 + L2_REACH + CANVAS_PAD) * 2; // ≈ 758

interface Geometry {
  size: number;
  cx: number;
  cy: number;
  r1: number;
  r2: number;
  centerW: number;
  centerH: number;
  l1W: number;
  l1H: number;
  l2W: number;
  l2H: number;
}

const GEOMETRY: Geometry = {
  size: CANVAS_SIZE,
  cx: CANVAS_SIZE / 2,
  cy: CANVAS_SIZE / 2,
  r1: R1,
  r2: R2,
  centerW: 168,
  centerH: 64,
  l1W: 124,
  l1H: 50,
  l2W: 100,
  l2H: 42,
};

function clampN(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LayoutNode {
  node: MindMapNode;
  x: number;
  y: number;
  level: 1 | 2;
  parentId: string | null;
}

interface ComputedLayout {
  l1Nodes: LayoutNode[];
  l2Nodes: LayoutNode[];
}

type CanvasVariant = "tree" | "hub";

export interface MindMapLiveState {
  selectedNodeId: string | null;
  selectedChapterId: string | null;
  zoomStates: Record<string, { zoom: number; offsetX: number; offsetY: number }>;
}

export interface MindMapScreenProps {
  bookTitle: string;
  bookId: string;
  status: MindMapStatus;
  data: MindMapData | null;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
  onJumpToPassage: (passageId: string) => void;
  onAsk: (node: MindMapNode) => void;
  onQuickAsk: (question: string, allowGeneralKnowledge: boolean) => void;
  initialTab?: "concepts" | "chapters";
  initialOpenChapterId?: string | null;
  onNavigationChange?: (tab: "concepts" | "chapters", openChapterId: string | null) => void;
  // Restored selection + zoom state from the previous session on this book.
  initialSelectedNodeId?: string | null;
  initialSelectedChapterId?: string | null;
  initialZoomStates?: Record<string, { zoom: number; offsetX: number; offsetY: number }>;
  // Ref written to on every render so App.tsx can capture state at close time.
  liveStateRef?: MutableRefObject<MindMapLiveState>;
}

// ─── Layout computation ───────────────────────────────────────────────────────

// "tree" layout: importance-ranked inner ring (L1) + outer branches (L2),
// used for concept maps where edges express L1→L2 relationships.
function computeLayout(data: MindMapData, g: Geometry): ComputedLayout {
  const { nodes, edges } = data;
  if (nodes.length === 0) return { l1Nodes: [], l2Nodes: [] };

  const sorted = [...nodes].sort((a, b) => b.importance - a.importance);
  const l1Count = Math.min(8, Math.max(3, Math.ceil(sorted.length * 0.55)));
  const l1Nodes = sorted.slice(0, l1Count);
  const l2Nodes = sorted.slice(l1Count);
  const l1Ids = new Set(l1Nodes.map((n) => n.id));

  const parentMap = new Map<string, string>();
  for (const e of edges) {
    if (l1Ids.has(e.from) && !l1Ids.has(e.to) && !parentMap.has(e.to)) {
      parentMap.set(e.to, e.from);
    }
  }
  const fallback = l1Nodes[0]?.id ?? "";
  for (const n of l2Nodes) {
    if (!parentMap.has(n.id)) parentMap.set(n.id, fallback);
  }

  const l1AngleMap = new Map<string, number>();
  const l1Layout: LayoutNode[] = l1Nodes.map((node, i) => {
    const angle = (i / l1Nodes.length) * 2 * Math.PI - Math.PI / 2;
    l1AngleMap.set(node.id, angle);
    return {
      node,
      x: g.cx + g.r1 * Math.cos(angle),
      y: g.cy + g.r1 * Math.sin(angle),
      level: 1 as const,
      parentId: null,
    };
  });

  const byParent = new Map<string, MindMapNode[]>();
  for (const n of l2Nodes) {
    const pid = parentMap.get(n.id) ?? fallback;
    byParent.set(pid, [...(byParent.get(pid) ?? []), n]);
  }

  const l2Layout: LayoutNode[] = [];
  for (const l1 of l1Layout) {
    const children = byParent.get(l1.node.id) ?? [];
    const pa = l1AngleMap.get(l1.node.id) ?? 0;
    const halfSpread = (Math.PI / 7) * Math.min(children.length, 3);
    children.forEach((child, j) => {
      const offset =
        children.length === 1
          ? 0
          : (j / (children.length - 1) - 0.5) * halfSpread * 2;
      const a = pa + offset;
      l2Layout.push({
        node: child,
        x: g.cx + g.r2 * Math.cos(a),
        y: g.cy + g.r2 * Math.sin(a),
        level: 2 as const,
        parentId: l1.node.id,
      });
    });
  }

  return { l1Nodes: l1Layout, l2Nodes: l2Layout };
}

// "hub" layout: every node is a spoke off the centre (no L1→L2 branches), used
// for the chapters overview where chapters are siblings, not a hierarchy.
function computeHubLayout(data: MindMapData, g: Geometry): ComputedLayout {
  const nodes = data.nodes;
  if (nodes.length === 0) return { l1Nodes: [], l2Nodes: [] };

  const innerCount =
    nodes.length <= 8 ? nodes.length : Math.ceil(nodes.length / 2);
  const inner = nodes.slice(0, innerCount);
  const outer = nodes.slice(innerCount);

  const place = (
    list: MindMapNode[],
    radius: number,
    level: 1 | 2,
    angleOffset: number
  ): LayoutNode[] =>
    list.map((node, i) => {
      const angle = (i / list.length) * 2 * Math.PI - Math.PI / 2 + angleOffset;
      return {
        node,
        x: g.cx + radius * Math.cos(angle),
        y: g.cy + radius * Math.sin(angle),
        level,
        parentId: null,
      };
    });

  return {
    l1Nodes: place(inner, g.r1, 1, 0),
    l2Nodes: place(outer, g.r2, 2, outer.length ? Math.PI / outer.length : 0),
  };
}

// Build a synthetic concept-graph where each chapter is a single node, for the
// chapters overview (rendered with the "hub" variant).
const MAX_CHAPTER_NODES = 20;

function chaptersToData(chapters: MindMapChapter[], genre: string): MindMapData {
  const sorted = [...chapters].sort((a, b) => a.index - b.index);
  const total = sorted.length;
  const visible =
    total <= MAX_CHAPTER_NODES
      ? sorted
      : Array.from({ length: MAX_CHAPTER_NODES }, (_, i) =>
          sorted[Math.round((i * (total - 1)) / (MAX_CHAPTER_NODES - 1))],
        );
  return {
    genre,
    edges: [],
    nodes: visible.map((c) => ({
      id: c.id,
      label: c.title ?? `Chapter ${c.index}`,
      type: "theme" as MindMapNodeType,
      summary: c.summary ?? "",
      importance: 0.8,
      passage_ids: c.jump_paragraph_id ? [c.jump_paragraph_id] : [],
      chapter: c.index,
    })),
  };
}

// ─── SVG edge helpers (curved connectors, pointerEvents disabled) ─────────────

function spokePath(cx: number, cy: number, x2: number, y2: number): string {
  const midX = (cx + x2) / 2;
  const midY = (cy + y2) / 2;
  const dx = midX - cx;
  const dy = midY - cy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ctrlX = midX + (dx / len) * 10;
  const ctrlY = midY + (dy / len) * 10;
  return `M ${cx} ${cy} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
}

function branchPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ctrlX = midX - (dy / len) * 6;
  const ctrlY = midY + (dx / len) * 6;
  return `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
}

// ─── Native node view ─────────────────────────────────────────────────────────

function NodeView({
  ln,
  geometry,
  onPress,
  showChapter = false,
}: {
  ln: LayoutNode;
  geometry: Geometry;
  onPress: () => void;
  showChapter?: boolean;
}) {
  const isL1 = ln.level === 1;
  const w = isL1 ? geometry.l1W : geometry.l2W;
  const h = isL1 ? geometry.l1H : geometry.l2H;
  const fontSize = isL1 ? 13 : 11;
  const fill = NODE_COLORS[ln.node.type];
  const color = NODE_TEXT_COLORS[ln.node.type];
  return (
    <Pressable
      testID={`mindmap-node-${ln.node.id}`}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.node,
        {
          left: ln.x - w / 2,
          top: ln.y - h / 2,
          width: w,
          minHeight: h,
          backgroundColor: fill,
          borderRadius: isL1 ? 12 : 14,
          opacity: pressed ? 0.6 : 1,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}
    >
      {showChapter && ln.node.chapter != null ? (
        <Text
          numberOfLines={1}
          style={{ color, fontSize: 9, fontWeight: "700", textAlign: "center", opacity: 0.7, letterSpacing: 0.4 }}
        >
          CH. {ln.node.chapter}
        </Text>
      ) : null}
      <Text
        numberOfLines={2}
        style={{ color, fontSize, fontWeight: "600", textAlign: "center" }}
      >
        {ln.node.label}
      </Text>
    </Pressable>
  );
}

// ─── Reusable radial canvas ───────────────────────────────────────────────────

function MindMapCanvas({
  data,
  variant,
  centerLabel,
  centerSubLabel,
  onNodeTap,
  onCenterTap,
  savedZoom,
  onZoomChange,
}: {
  data: MindMapData;
  variant: CanvasVariant;
  centerLabel: string;
  centerSubLabel?: string | null;
  onNodeTap: (node: MindMapNode) => void;
  onCenterTap?: () => void;
  savedZoom?: { zoom: number; offsetX: number; offsetY: number };
  onZoomChange?: (zoom: number, offsetX: number, offsetY: number) => void;
}) {
  const { width: screenW } = useWindowDimensions();
  const geometry = GEOMETRY;
  const size = geometry.size;

  const layout = useMemo<ComputedLayout>(
    () =>
      variant === "hub"
        ? computeHubLayout(data, geometry)
        : computeLayout(data, geometry),
    [data, geometry, variant]
  );

  const mapWidth = geometry.r2 * 2 + geometry.l2W;
  const fitZoom = clampN((screenW * 0.9) / mapWidth, MIN_ZOOM, 1);
  const initialZoom = savedZoom?.zoom ?? fitZoom;

  if (layout.l1Nodes.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Nothing to show</Text>
        <Text style={styles.emptySubtitle}>This view has no nodes.</Text>
      </View>
    );
  }

  // In "hub" mode every node spokes off the centre; in "tree" mode only L1 does.
  const spokeNodes =
    variant === "hub" ? [...layout.l1Nodes, ...layout.l2Nodes] : layout.l1Nodes;

  return (
    <ReactNativeZoomableView
      key={variant + centerLabel}
      // Size the zoom subject to the content so it centres on the map centre
      // (this style lands on the inner transformed view).
      style={{ width: size, height: size }}
      contentWidth={size}
      contentHeight={size}
      initialZoom={initialZoom}
      initialOffsetX={savedZoom?.offsetX ?? 0}
      initialOffsetY={savedZoom?.offsetY ?? 0}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      // A square map can't fill a portrait viewport without clipping, so don't
      // bind to borders — let it sit fully visible and pan free.
      bindToBorders={false}
      doubleTapZoomToCenter={false}
      visualTouchFeedbackEnabled={false}
      onZoomEnd={(_, __, e) => onZoomChange?.(e.zoomLevel, e.offsetX, e.offsetY)}
      onShiftingEnd={(_, __, e) => onZoomChange?.(e.zoomLevel, e.offsetX, e.offsetY)}
    >
      <View style={{ width: size, height: size }}>
        <Svg
          width={size}
          height={size}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <Marker
              id="arr"
              markerWidth={7}
              markerHeight={5}
              refX={7}
              refY={2.5}
              orient="auto"
            >
              <Polygon points="0 0, 7 2.5, 0 5" fill="#c4bdb5" />
            </Marker>
          </Defs>

          {/* L1 → L2 dashed branches (tree variant only) */}
          {variant === "tree" &&
            layout.l2Nodes.map((l2, i) => {
              const parent = layout.l1Nodes.find(
                (l1) => l1.node.id === l2.parentId
              );
              if (!parent) return null;
              return (
                <Path
                  key={`br-${i}`}
                  d={branchPath(parent.x, parent.y, l2.x, l2.y)}
                  stroke="#d8d2cc"
                  strokeWidth={1.2}
                  strokeDasharray="5,3"
                  fill="none"
                />
              );
            })}

          {/* Center → node spokes */}
          {spokeNodes.map((ln, i) => (
            <Path
              key={`sp-${i}`}
              d={spokePath(geometry.cx, geometry.cy, ln.x, ln.y)}
              stroke="#c4bdb5"
              strokeWidth={1.8}
              fill="none"
              markerEnd="url(#arr)"
            />
          ))}
        </Svg>

        {/* Center node */}
        <Pressable
          testID="mindmap-center-node"
          onPress={onCenterTap}
          disabled={!onCenterTap}
          hitSlop={8}
          style={({ pressed }) => [
            styles.centerNode,
            {
              left: geometry.cx - geometry.centerW / 2,
              top: geometry.cy - geometry.centerH / 2,
              width: geometry.centerW,
              minHeight: geometry.centerH,
              opacity: onCenterTap && pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={styles.centerTitle} numberOfLines={2}>
            {centerLabel}
          </Text>
          {centerSubLabel ? (
            <Text style={styles.centerGenre} numberOfLines={1}>
              {centerSubLabel}
            </Text>
          ) : null}
        </Pressable>

        {/* Outer nodes first so inner nodes sit above when they meet */}
        {layout.l2Nodes.map((ln) => (
          <NodeView
            key={ln.node.id}
            ln={ln}
            geometry={geometry}
            onPress={() => onNodeTap(ln.node)}
            showChapter={variant === "hub"}
          />
        ))}
        {layout.l1Nodes.map((ln) => (
          <NodeView
            key={ln.node.id}
            ln={ln}
            geometry={geometry}
            onPress={() => onNodeTap(ln.node)}
            showChapter={variant === "hub"}
          />
        ))}
      </View>
    </ReactNativeZoomableView>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MindMapScreen({
  bookTitle,
  bookId,
  status,
  data,
  error,
  onClose,
  onRetry,
  onJumpToPassage,
  onAsk,
  onQuickAsk,
  initialTab = "concepts",
  initialOpenChapterId = null,
  onNavigationChange,
  initialSelectedNodeId = null,
  initialSelectedChapterId = null,
  initialZoomStates,
  liveStateRef,
}: MindMapScreenProps) {
  const [tab, setTab] = useState<"concepts" | "chapters">(initialTab);
  const [openChapter, setOpenChapter] = useState<MindMapChapter | null>(null);
  const [selectedNode, setSelectedNode] = useState<MindMapNode | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<MindMapChapter | null>(
    null
  );

  const chapters = data?.chapters ?? [];
  const hasChapters = chapters.length > 0;
  const genre = data?.genre ?? "";

  // Restore drilled chapter from initialOpenChapterId once data arrives (one-shot).
  const pendingChapterId = useRef(initialOpenChapterId);
  useEffect(() => {
    if (data && pendingChapterId.current) {
      const ch = data.chapters?.find((c) => c.id === pendingChapterId.current) ?? null;
      if (ch) setOpenChapter(ch);
      pendingChapterId.current = null;
    }
  }, [data]);

  // Restore open popup (node or chapter sheet) from previous session (one-shot).
  const pendingNodeId = useRef(initialSelectedNodeId);
  const pendingSheetChapterId = useRef(initialSelectedChapterId);
  useEffect(() => {
    if (!data) return;
    if (pendingNodeId.current) {
      const allNodes = [
        ...data.nodes,
        ...(data.chapters ?? []).flatMap((ch) => ch.nodes),
      ];
      const node = allNodes.find((n) => n.id === pendingNodeId.current) ?? null;
      if (node) setSelectedNode(node);
      pendingNodeId.current = null;
    }
    if (pendingSheetChapterId.current) {
      const ch = (data.chapters ?? []).find((c) => c.id === pendingSheetChapterId.current) ?? null;
      if (ch) setSelectedChapter(ch);
      pendingSheetChapterId.current = null;
    }
  }, [data]);

  // Keep liveStateRef current at every render so App.tsx can capture selection
  // and zoom at close time. Written synchronously (not in an effect) so the value
  // is available even before a queued setState has been applied — this is what
  // preserves the node that was selected when the user tapped a quick-ask chip.
  if (liveStateRef) {
    liveStateRef.current.selectedNodeId = selectedNode?.id ?? null;
    liveStateRef.current.selectedChapterId = selectedChapter?.id ?? null;
  }

  const chaptersData = useMemo(
    () => (hasChapters ? chaptersToData(chapters, genre) : null),
    [chapters, hasChapters, genre]
  );

  const goToTab = (next: "concepts" | "chapters") => {
    setTab(next);
    setOpenChapter(null);
    setSelectedNode(null);
    setSelectedChapter(null);
    onNavigationChange?.(next, null);
  };

  const drillIntoChapter = (ch: MindMapChapter) => {
    setOpenChapter(ch);
    setSelectedChapter(null);
    onNavigationChange?.(tab, ch.id);
  };

  const backToChapterOverview = () => {
    setOpenChapter(null);
    onNavigationChange?.("chapters", null);
  };

  const isChapterOverview = tab === "chapters" && openChapter === null;

  // Canvas keys mirror the ReactNativeZoomableView `key` prop so zoom state is
  // saved and restored per logical canvas.
  const conceptsCanvasKey = "tree" + bookTitle;
  const chaptersCanvasKey = "hub" + bookTitle;
  const chapterDrillKey = openChapter
    ? "tree" + (openChapter.title ?? `Chapter ${openChapter.index}`)
    : null;

  const makeZoomHandler = (key: string) =>
    (zoom: number, offsetX: number, offsetY: number) => {
      if (liveStateRef) {
        liveStateRef.current.zoomStates[key] = { zoom, offsetX, offsetY };
      }
    };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {bookTitle}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Tab chips / drill-down breadcrumb */}
        {status === "ready" && (hasChapters || openChapter) ? (
          <View style={styles.tabBar}>
            {openChapter ? (
              <TouchableOpacity
                style={styles.crumbButton}
                onPress={backToChapterOverview}
                accessibilityRole="button"
                accessibilityLabel="Back to chapters"
              >
                <Text style={styles.crumbText} numberOfLines={1}>
                  ‹ Chapters · {openChapter.title ?? `Chapter ${openChapter.index}`}
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <Chip
                  label="Concepts"
                  active={tab === "concepts"}
                  onPress={() => goToTab("concepts")}
                />
                <Chip
                  label="Chapters"
                  active={tab === "chapters"}
                  onPress={() => goToTab("chapters")}
                />
              </>
            )}
          </View>
        ) : null}

        {/* Content */}
        <View style={styles.content}>
          {status === "generating" && (
            <View style={styles.centeredState}>
              <ActivityIndicator size="large" color="#244f38" />
              <Text style={styles.stateText}>Generating mind map…</Text>
              <Text style={styles.stateSubText}>
                You can close this — it'll keep generating in the background.
              </Text>
            </View>
          )}

          {status === "failed" && (
            <View style={styles.centeredState}>
              <Text style={styles.failedTitle}>Generation failed</Text>
              {error ? <Text style={styles.failedDetail}>{error}</Text> : null}
              <TouchableOpacity
                onPress={onRetry}
                style={styles.retryButton}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {status === "insufficient_content" && (
            <View style={styles.centeredState}>
              <Text style={styles.stateText}>Not enough content</Text>
              <Text style={styles.stateSubText}>
                This book doesn't have enough content to generate a mind map.
              </Text>
            </View>
          )}

          {status === "ready" && data ? (
            data.nodes.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>No concepts extracted</Text>
                <Text style={styles.emptySubtitle}>
                  The mind map was generated but contains no nodes.
                </Text>
              </View>
            ) : openChapter ? (
              <MindMapCanvas
                data={{
                  genre,
                  nodes: openChapter.nodes,
                  edges: openChapter.edges,
                }}
                variant="tree"
                centerLabel={openChapter.title ?? `Chapter ${openChapter.index}`}
                centerSubLabel={`${openChapter.nodes.length} concepts`}
                onNodeTap={setSelectedNode}
                onCenterTap={() => setSelectedChapter(openChapter)}
                savedZoom={chapterDrillKey ? initialZoomStates?.[chapterDrillKey] : undefined}
                onZoomChange={chapterDrillKey ? makeZoomHandler(chapterDrillKey) : undefined}
              />
            ) : isChapterOverview && chaptersData ? (
              <MindMapCanvas
                data={chaptersData}
                variant="hub"
                centerLabel={bookTitle}
                centerSubLabel={`${chapters.length} chapters`}
                onNodeTap={(node) => {
                  const ch = chapters.find((c) => c.id === node.id) ?? null;
                  setSelectedChapter(ch);
                }}
                savedZoom={initialZoomStates?.[chaptersCanvasKey]}
                onZoomChange={makeZoomHandler(chaptersCanvasKey)}
              />
            ) : (
              <MindMapCanvas
                data={data}
                variant="tree"
                centerLabel={bookTitle}
                centerSubLabel={genre || null}
                onNodeTap={setSelectedNode}
                savedZoom={initialZoomStates?.[conceptsCanvasKey]}
                onZoomChange={makeZoomHandler(conceptsCanvasKey)}
              />
            )
          ) : null}
        </View>

        {/* Legend — concept node types only (hidden on the chapters overview) */}
        {status === "ready" && !isChapterOverview && (
          <View style={styles.legend}>
            {(Object.keys(NODE_COLORS) as MindMapNodeType[]).map((type) => (
              <View key={type} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendChip,
                    { backgroundColor: NODE_COLORS[type] },
                  ]}
                />
                <Text style={styles.legendLabel}>{type}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Concept node detail sheet */}
      <NodeTapSheet
        node={selectedNode}
        bookId={bookId}
        onClose={() => setSelectedNode(null)}
        onJumpToPassage={(passageId) => {
          setSelectedNode(null);
          onJumpToPassage(passageId);
        }}
        onAsk={(node) => {
          setSelectedNode(null);
          onAsk(node);
        }}
        onQuickAsk={(question, allowGeneralKnowledge) => {
          setSelectedNode(null);
          onQuickAsk(question, allowGeneralKnowledge);
        }}
      />

      {/* Chapter detail sheet */}
      <ChapterTapSheet
        chapter={selectedChapter}
        onClose={() => setSelectedChapter(null)}
        onJumpToChapter={(paragraphId) => {
          setSelectedChapter(null);
          onJumpToPassage(paragraphId);
        }}
        onExplore={openChapter === null ? (chapter) => {
          setSelectedChapter(null);
          drillIntoChapter(chapter);
        } : undefined}
        onQuickAsk={(question, allowGeneralKnowledge) => {
          setSelectedChapter(null);
          onQuickAsk(question, allowGeneralKnowledge);
        }}
      />
    </Modal>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      testID={`mindmap-tab-${label.toLowerCase()}`}
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e4dfd6",
  },
  backButton: { minWidth: 70 },
  backText: { color: "#244f38", fontSize: 15, fontWeight: "600" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: "#171715",
  },
  headerSpacer: { minWidth: 70 },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee7dc",
    backgroundColor: "#fafaf8",
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "#efece6",
  },
  chipActive: { backgroundColor: "#244f38" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#6d6860" },
  chipTextActive: { color: "#fff" },
  crumbButton: { flex: 1, paddingVertical: 4 },
  crumbText: { fontSize: 14, fontWeight: "600", color: "#244f38" },
  content: { flex: 1 },
  centeredState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  stateText: { fontSize: 16, fontWeight: "600", color: "#78746d", marginTop: 8 },
  stateSubText: { fontSize: 13, color: "#a8a298", textAlign: "center" },
  failedTitle: { fontSize: 18, fontWeight: "700", color: "#9c2f2f" },
  failedDetail: { fontSize: 13, color: "#b06060", textAlign: "center" },
  retryButton: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: "#244f38",
    borderRadius: 20,
  },
  retryText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "#78746d" },
  emptySubtitle: { fontSize: 13, color: "#a8a298", textAlign: "center" },
  node: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  centerNode: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: CENTER_COLOR,
  },
  centerTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  centerGenre: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 10,
    marginTop: 2,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#e4dfd6",
    backgroundColor: "#fafaf8",
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendChip: { width: 13, height: 13, borderRadius: 3 },
  legendLabel: { fontSize: 11, color: "#78746d", textTransform: "capitalize" },
});
