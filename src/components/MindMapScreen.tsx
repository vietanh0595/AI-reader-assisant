import React, { useMemo, useState } from "react";
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
  MindMapData,
  MindMapNode,
  MindMapNodeType,
  MindMapStatus,
} from "../rag/mindmapTypes";
import { NodeTapSheet } from "./NodeTapSheet";

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
const CENTER_COLOR = "#7c5cbf";

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.5;

// ─── Geometry ─────────────────────────────────────────────────────────────────
// A fixed-size square canvas sized tightly around the map (independent of the
// screen) with generous, absolute spacing so nodes never overlap. The canvas is
// wrapped in <ReactNativeZoomableView>, which handles all pan/zoom/centering.

const R1 = 178; // inner ring radius — wide enough to space 8 L1 nodes
const R2 = 293; // outer ring radius (R1 + radial gap for L2)
const L2_REACH = 56; // half-extent of an L2 node beyond its centre
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
}

// ─── Layout computation ───────────────────────────────────────────────────────

function computeLayout(data: MindMapData, g: Geometry): ComputedLayout {
  const { nodes, edges } = data;
  if (nodes.length === 0) return { l1Nodes: [], l2Nodes: [] };

  // Sort by importance descending; top ~55% → L1, remainder → L2
  const sorted = [...nodes].sort((a, b) => b.importance - a.importance);
  const l1Count = Math.min(8, Math.max(3, Math.ceil(sorted.length * 0.55)));
  const l1Nodes = sorted.slice(0, l1Count);
  const l2Nodes = sorted.slice(l1Count);
  const l1Ids = new Set(l1Nodes.map((n) => n.id));

  // Find an L1 parent for each L2 node via the edge list
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

  // Position L1 nodes evenly around the inner ring (start at top)
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

  // Group L2 nodes under their parent and fan them around the parent angle
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
}: {
  ln: LayoutNode;
  geometry: Geometry;
  onPress: () => void;
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
      <Text
        numberOfLines={2}
        style={{ color, fontSize, fontWeight: "600", textAlign: "center" }}
      >
        {ln.node.label}
      </Text>
    </Pressable>
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
}: MindMapScreenProps) {
  const { width: screenW } = useWindowDimensions();
  const geometry = GEOMETRY;
  const size = geometry.size;
  const [selectedNode, setSelectedNode] = useState<MindMapNode | null>(null);

  const layout = useMemo<ComputedLayout | null>(() => {
    if (!data) return null;
    return computeLayout(data, geometry);
  }, [data, geometry]);

  // Start zoomed so the whole map (its widest ring) fits the screen width with
  // a margin; the user can pinch in/out and pan freely from there.
  const mapWidth = geometry.r2 * 2 + geometry.l2W;
  const initialZoom = clampN((screenW * 0.9) / mapWidth, MIN_ZOOM, 1);

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

        {/* Content */}
        <View style={styles.content}>
          {status === "generating" && (
            <View style={styles.centeredState}>
              <ActivityIndicator size="large" color="#7c5cbf" />
              <Text style={styles.stateText}>Generating mind map…</Text>
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

          {status === "ready" && layout ? (
            layout.l1Nodes.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>No concepts extracted</Text>
                <Text style={styles.emptySubtitle}>
                  The mind map was generated but contains no nodes.
                </Text>
              </View>
            ) : (
              <ReactNativeZoomableView
                // Size the zoom subject to the content so it centres on the map
                // centre (this style lands on the inner transformed view).
                style={{ width: size, height: size }}
                contentWidth={size}
                contentHeight={size}
                initialZoom={initialZoom}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                // A square map can't fill a portrait viewport without clipping,
                // so don't bind to borders — let it sit fully visible and pan free.
                bindToBorders={false}
                doubleTapZoomToCenter={false}
                visualTouchFeedbackEnabled={false}
              >
                <View style={{ width: size, height: size }}>
                  {/* Connector lines (non-interactive) */}
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

                    {/* L1 → L2 dashed branches */}
                    {layout.l2Nodes.map((l2, i) => {
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

                    {/* Center → L1 spokes */}
                    {layout.l1Nodes.map((l1, i) => (
                      <Path
                        key={`sp-${i}`}
                        d={spokePath(geometry.cx, geometry.cy, l1.x, l1.y)}
                        stroke="#c4bdb5"
                        strokeWidth={1.8}
                        fill="none"
                        markerEnd="url(#arr)"
                      />
                    ))}
                  </Svg>

                  {/* Center node (native, not pressable) */}
                  <View
                    style={[
                      styles.centerNode,
                      {
                        left: geometry.cx - geometry.centerW / 2,
                        top: geometry.cy - geometry.centerH / 2,
                        width: geometry.centerW,
                        minHeight: geometry.centerH,
                      },
                    ]}
                  >
                    <Text style={styles.centerTitle} numberOfLines={2}>
                      {bookTitle}
                    </Text>
                    {data?.genre ? (
                      <Text style={styles.centerGenre} numberOfLines={1}>
                        {data.genre}
                      </Text>
                    ) : null}
                  </View>

                  {/* L2 nodes (below L1 in z-order) */}
                  {layout.l2Nodes.map((ln) => (
                    <NodeView
                      key={ln.node.id}
                      ln={ln}
                      geometry={geometry}
                      onPress={() => setSelectedNode(ln.node)}
                    />
                  ))}

                  {/* L1 nodes */}
                  {layout.l1Nodes.map((ln) => (
                    <NodeView
                      key={ln.node.id}
                      ln={ln}
                      geometry={geometry}
                      onPress={() => setSelectedNode(ln.node)}
                    />
                  ))}
                </View>
              </ReactNativeZoomableView>
            )
          ) : null}
        </View>

        {/* Legend */}
        {status === "ready" && (
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

      {/* Node detail sheet — nested inside this Modal so it stacks above the
          mind map on iOS (a sibling Modal would render behind it). */}
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
      />
    </Modal>
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
    backgroundColor: "#7c5cbf",
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
