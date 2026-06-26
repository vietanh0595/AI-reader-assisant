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

function EdgePath({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  // Pull control point 30px toward the center (CX, CY)
  const dx = CX - midX;
  const dy = CY - midY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ctrlX = midX + (dx / len) * 30;
  const ctrlY = midY + (dy / len) * 30;

  const d = `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;

  return (
    <Path
      d={d}
      stroke="#888"
      strokeWidth={1.5}
      fill="none"
      markerEnd="url(#arrowhead)"
    />
  );
}

function NodeShape({
  node,
  x,
  y,
  isLeaf,
  onTap,
}: {
  node: MindMapNode;
  x: number;
  y: number;
  isLeaf: boolean;
  onTap: () => void;
}) {
  const fill = NODE_COLORS[node.type];
  const textColor = NODE_TEXT_COLORS[node.type];
  const scale = 0.85 + node.importance * 0.3;
  const w = BASE_WIDTH * scale;
  const h = BASE_HEIGHT * scale;

  if (isLeaf) {
    // Ellipse: rx=45 * scale, ry=18 * scale
    const rx = 45 * scale;
    const ry = 18 * scale;
    return (
      <G onPress={onTap}>
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

  // Branch node: rounded rect
  return (
    <G onPress={onTap}>
      <Rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={10}
        ry={10}
        fill={fill}
      />
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
  const layout = useMemo(() => {
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
            <ScrollView
              contentContainerStyle={styles.svgContainer}
              maximumZoomScale={3}
              minimumZoomScale={0.5}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Svg width={SVG_WIDTH} height={SVG_HEIGHT} viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}>
                <Defs>
                  <Marker
                    id="arrowhead"
                    markerWidth={8}
                    markerHeight={6}
                    refX={8}
                    refY={3}
                    orient="auto"
                  >
                    <Polygon points="0 0, 8 3, 0 6" fill="#888" />
                  </Marker>
                </Defs>

                {/* Edges first (below nodes) */}
                {layout.edges.map((le, i) => (
                  <EdgePath
                    key={i}
                    x1={le.x1}
                    y1={le.y1}
                    x2={le.x2}
                    y2={le.y2}
                  />
                ))}

                {/* Center node */}
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
                    y={CY}
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
                      y={CY + 14}
                      textAnchor="middle"
                      alignmentBaseline="middle"
                      fontSize={9}
                      fill="rgba(255,255,255,0.7)"
                    >
                      {data.genre}
                    </SvgText>
                  ) : null}
                </G>

                {/* Leaf / branch nodes */}
                {layout.nodes.map((ln) => (
                  <NodeShape
                    key={ln.node.id}
                    node={ln.node}
                    x={ln.x}
                    y={ln.y}
                    isLeaf={ln.isLeaf}
                    onTap={() => onNodeTap(ln.node)}
                  />
                ))}
              </Svg>
            </ScrollView>
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
