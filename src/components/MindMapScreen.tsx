import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, {
  Defs,
  Ellipse,
  G,
  Marker,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import {
  MindMapData,
  MindMapEdge,
  MindMapNode,
  MindMapNodeType,
  MindMapStatus,
} from "../rag/mindmapTypes";

// ─── Color constants ──────────────────────────────────────────────────────────

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

const CENTER_NODE_COLOR = "#7c5cbf";
const CENTER_NODE_TEXT = "#fff";

// ─── Layout constants ─────────────────────────────────────────────────────────

const SVG_WIDTH = 600;
const SVG_HEIGHT = 600;
const CX = SVG_WIDTH / 2;
const CY = SVG_HEIGHT / 2;
const R1 = 180;

const BASE_WIDTH = 90;
const BASE_HEIGHT = 36;
const CENTER_WIDTH = 110;
const CENTER_HEIGHT = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

interface LayoutNode {
  node: MindMapNode;
  x: number;
  y: number;
  isLeaf: boolean;
}

interface LayoutEdge {
  edge: MindMapEdge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ComputedLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface MindMapScreenProps {
  bookTitle: string;
  bookId: string;
  status: MindMapStatus;
  data: MindMapData | null;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
  onNodeTap: (node: MindMapNode) => void;
}

// ─── Layout computation ───────────────────────────────────────────────────────

function computeLayout(data: MindMapData): ComputedLayout {
  const { nodes, edges } = data;

  // Track which node ids have outgoing edges (branch nodes)
  const nodesWithOutgoing = new Set(edges.map((e) => e.from));

  // Position map: nodeId -> {x, y}
  const positionMap = new Map<string, { x: number; y: number }>();

  const total = nodes.length;
  const layoutNodes: LayoutNode[] = nodes.map((node, index) => {
    const angle = (index / total) * 2 * Math.PI;
    const x = CX + R1 * Math.cos(angle);
    const y = CY + R1 * Math.sin(angle);
    const isLeaf = !nodesWithOutgoing.has(node.id);
    positionMap.set(node.id, { x, y });
    return { node, x, y, isLeaf };
  });

  const layoutEdges: LayoutEdge[] = edges
    .map((edge) => {
      const from = positionMap.get(edge.from);
      const to = positionMap.get(edge.to);
      if (!from || !to) return null;
      return {
        edge,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      };
    })
    .filter((e): e is LayoutEdge => e !== null);

  return { nodes: layoutNodes, edges: layoutEdges };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Spoke from center to a ring node — the primary "mind map" edge
function SpokeEdge({ x2, y2 }: { x2: number; y2: number }) {
  const midX = (CX + x2) / 2;
  const midY = (CY + y2) / 2;
  // Slight outward bow: pull control point away from center by 20px
  const dx = midX - CX;
  const dy = midY - CY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ctrlX = midX + (dx / len) * 20;
  const ctrlY = midY + (dy / len) * 20;
  const d = `M ${CX} ${CY} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
  return (
    <Path d={d} stroke="#c4bdb5" strokeWidth={1.5} fill="none" markerEnd="url(#arrowhead)" />
  );
}

// Pure-visual node shape — no onPress here; tapping is handled by the overlay below the SVG
function NodeShape({
  node,
  x,
  y,
  isLeaf,
}: {
  node: MindMapNode;
  x: number;
  y: number;
  isLeaf: boolean;
}) {
  const fill = NODE_COLORS[node.type];
  const textColor = NODE_TEXT_COLORS[node.type];
  const scale = 0.85 + node.importance * 0.3;
  const w = BASE_WIDTH * scale;
  const h = BASE_HEIGHT * scale;

  if (isLeaf) {
    const rx = 45 * scale;
    const ry = 18 * scale;
    return (
      <G>
        <Ellipse cx={x} cy={y} rx={rx} ry={ry} fill={fill} />
        <SvgText
          x={x}
          y={y}
          textAnchor="middle"
          alignmentBaseline="middle"
          fontSize={10}
          fill={textColor}
          fontWeight="600"
        >
          {node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label}
        </SvgText>
      </G>
    );
  }

  return (
    <G>
      <Rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={10} ry={10} fill={fill} />
      <SvgText
        x={x}
        y={y}
        textAnchor="middle"
        alignmentBaseline="middle"
        fontSize={10}
        fill={textColor}
        fontWeight="600"
      >
        {node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label}
      </SvgText>
    </G>
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
  onNodeTap,
}: MindMapScreenProps) {
  const layout = useMemo<ComputedLayout | null>(() => {
    if (!data) return null;
    return computeLayout(data);
  }, [data]);

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
              {error ? (
                <Text style={styles.failedDetail}>{error}</Text>
              ) : null}
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
                Read more of the book before generating a mind map.
              </Text>
            </View>
          )}

          {status === "ready" && layout ? (
            layout.nodes.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>No concepts extracted</Text>
                <Text style={styles.emptySubtitle}>The mind map was generated but contains no nodes.</Text>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={styles.svgContainer}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
              >
                {/*
                 * We layer two things inside a fixed-size View:
                 *   1. The SVG (visual only — pointerEvents="none" so it never
                 *      swallows touches)
                 *   2. Absolutely-positioned TouchableOpacity elements that sit
                 *      exactly over each node and handle taps reliably on iOS.
                 */}
                <View style={{ width: SVG_WIDTH, height: SVG_HEIGHT }}>
                  <Svg
                    width={SVG_WIDTH}
                    height={SVG_HEIGHT}
                    viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                    pointerEvents="none"
                  >
                    <Defs>
                      <Marker
                        id="arrowhead"
                        markerWidth={8}
                        markerHeight={6}
                        refX={8}
                        refY={3}
                        orient="auto"
                      >
                        <Polygon points="0 0, 8 3, 0 6" fill="#c4bdb5" />
                      </Marker>
                    </Defs>

                    {/* Hub-and-spoke: one curved line from center to every ring node */}
                    {layout.nodes.map((ln, i) => (
                      <SpokeEdge key={`spoke-${i}`} x2={ln.x} y2={ln.y} />
                    ))}

                    {/* Center node (drawn after spokes so it sits on top) */}
                    <G>
                      <Rect
                        x={CX - CENTER_WIDTH / 2}
                        y={CY - CENTER_HEIGHT / 2}
                        width={CENTER_WIDTH}
                        height={CENTER_HEIGHT}
                        rx={10}
                        ry={10}
                        fill={CENTER_NODE_COLOR}
                      />
                      <SvgText
                        x={CX}
                        y={CY - 6}
                        textAnchor="middle"
                        alignmentBaseline="middle"
                        fontSize={11}
                        fill={CENTER_NODE_TEXT}
                        fontWeight="700"
                      >
                        {bookTitle.length > 16 ? bookTitle.slice(0, 15) + "…" : bookTitle}
                      </SvgText>
                      {data?.genre ? (
                        <SvgText
                          x={CX}
                          y={CY + 10}
                          textAnchor="middle"
                          alignmentBaseline="middle"
                          fontSize={9}
                          fill="rgba(255,255,255,0.7)"
                        >
                          {data.genre}
                        </SvgText>
                      ) : null}
                    </G>

                    {/* Ring nodes — visual only */}
                    {layout.nodes.map((ln) => (
                      <NodeShape
                        key={ln.node.id}
                        node={ln.node}
                        x={ln.x}
                        y={ln.y}
                        isLeaf={ln.isLeaf}
                      />
                    ))}
                  </Svg>

                  {/* Touch overlay: one invisible TouchableOpacity per node */}
                  {layout.nodes.map((ln) => {
                    const scale = 0.85 + ln.node.importance * 0.3;
                    const hw = ln.isLeaf ? 45 * scale * 2 + 16 : BASE_WIDTH * scale + 16;
                    const hh = ln.isLeaf ? 18 * scale * 2 + 16 : BASE_HEIGHT * scale + 16;
                    return (
                      <TouchableOpacity
                        key={ln.node.id}
                        testID={`mindmap-node-${ln.node.id}`}
                        style={{
                          position: "absolute",
                          left: ln.x - hw / 2,
                          top: ln.y - hh / 2,
                          width: hw,
                          height: hh,
                        }}
                        onPress={() => onNodeTap(ln.node)}
                        activeOpacity={0.7}
                      />
                    );
                  })}
                </View>
              </ScrollView>
            )
          ) : null}
        </View>

        {/* Legend */}
        {status === "ready" && (
          <View style={styles.legend}>
            {(Object.keys(NODE_COLORS) as MindMapNodeType[]).map((type) => (
              <View key={type} style={styles.legendItem}>
                <View
                  style={[styles.legendChip, { backgroundColor: NODE_COLORS[type] }]}
                />
                <Text style={styles.legendLabel}>{type}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e4dfd6",
  },
  backButton: {
    minWidth: 70,
  },
  backText: {
    color: "#244f38",
    fontSize: 15,
    fontWeight: "600",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: "#171715",
  },
  headerSpacer: {
    minWidth: 70,
  },
  content: {
    flex: 1,
  },
  centeredState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  stateText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#78746d",
    marginTop: 8,
  },
  stateSubText: {
    fontSize: 13,
    color: "#a8a298",
    textAlign: "center",
  },
  failedTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#9c2f2f",
  },
  failedDetail: {
    fontSize: 13,
    color: "#b06060",
    textAlign: "center",
  },
  retryButton: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: "#7c5cbf",
    borderRadius: 20,
  },
  retryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#78746d",
  },
  emptySubtitle: {
    fontSize: 13,
    color: "#a8a298",
    textAlign: "center",
  },
  svgContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#e4dfd6",
    backgroundColor: "#fafaf8",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendChip: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 12,
    color: "#78746d",
    textTransform: "capitalize",
  },
});
