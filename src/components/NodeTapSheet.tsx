import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { MindMapNode, MindMapNodeType } from "../rag/mindmapTypes";

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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface NodeTapSheetProps {
  node: MindMapNode | null;
  bookId: string;
  onClose: () => void;
  onJumpToPassage: (passageId: string) => void;
  onAsk: (node: MindMapNode) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NodeTapSheet({
  node,
  bookId: _bookId,
  onClose,
  onJumpToPassage,
  onAsk,
}: NodeTapSheetProps) {
  const translateY = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    if (node !== null) {
      translateY.setValue(300);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    }
  }, [node]);

  if (node === null) {
    return null;
  }

  const typeColor = NODE_COLORS[node.type];
  const typeTextColor = NODE_TEXT_COLORS[node.type];

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel="Dismiss">
        <View style={styles.backdrop} testID="nodeTapSheet-backdrop" />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        {/* Handle bar */}
        <View style={styles.handleBar} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.nodeLabel} numberOfLines={2}>
            {node.label}
          </Text>
          <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
            <Text style={[styles.typeBadgeText, { color: typeTextColor }]}>
              {node.type}
            </Text>
          </View>
        </View>

        <View style={styles.separator} />

        {/* Summary */}
        <View style={styles.section}>
          <Text style={styles.summaryText}>{node.summary}</Text>
        </View>

        <View style={styles.separator} />

        {/* Passages */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            {node.passage_ids.length} PASSAGES
          </Text>
          <ScrollView style={styles.passagesScroll} nestedScrollEnabled>
            {node.passage_ids.map((passageId) => (
              <TouchableOpacity
                key={passageId}
                style={[styles.passageRow, { borderLeftColor: typeColor }]}
                onPress={() => onJumpToPassage(passageId)}
                accessibilityRole="button"
                accessibilityLabel={`Passage ${passageId}`}
              >
                <Text style={styles.passageIdText} numberOfLines={1}>
                  Passage: {passageId}
                </Text>
                <Text style={styles.passageSubtitle}>Tap to jump →</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.separator} />

        {/* Ask button */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.askButton}
            onPress={() => onAsk(node)}
            accessibilityRole="button"
            accessibilityLabel={`Ask about ${node.label}`}
          >
            <Text style={styles.askButtonText}>
              💬 Ask about {node.label}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(23,23,21,0.45)",
  },
  sheet: {
    backgroundColor: "#fffdf8",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  handleBar: {
    alignSelf: "center",
    backgroundColor: "#ccc",
    borderRadius: 2,
    height: 4,
    marginTop: 10,
    marginBottom: 12,
    width: 36,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  nodeLabel: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#171715",
  },
  typeBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  separator: {
    height: 1,
    backgroundColor: "#e4dfd6",
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: "#78746d",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 13,
    color: "#6d6860",
    lineHeight: 22,
  },
  passagesScroll: {
    maxHeight: 200,
  },
  passageRow: {
    borderLeftWidth: 3,
    borderLeftColor: "#ccc",
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 6,
  },
  passageIdText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#171715",
  },
  passageSubtitle: {
    fontSize: 12,
    color: "#78746d",
    marginTop: 2,
  },
  askButton: {
    backgroundColor: "#7c5cbf",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  askButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
