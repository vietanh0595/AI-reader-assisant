import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { MindMapChapter } from "../rag/mindmapTypes";

export interface ChapterTapSheetProps {
  chapter: MindMapChapter | null;
  onClose: () => void;
  onJumpToChapter: (paragraphId: string) => void;
  onExplore: (chapter: MindMapChapter) => void;
}

export function ChapterTapSheet({
  chapter,
  onClose,
  onJumpToChapter,
  onExplore,
}: ChapterTapSheetProps) {
  const translateY = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    if (chapter !== null) {
      translateY.setValue(300);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    }
  }, [chapter]);

  if (chapter === null) {
    return null;
  }

  const title = chapter.title ?? `Chapter ${chapter.index}`;
  const conceptCount = chapter.nodes.length;

  return (
    // Absolute-fill overlay (not a Modal) so it stacks above the mind map, which
    // is itself rendered inside a Modal.
    <View style={styles.overlay} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel="Dismiss">
        <View style={styles.backdrop} testID="chapterTapSheet-backdrop" />
      </TouchableWithoutFeedback>

      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handleBar} />

        <View style={styles.header}>
          <Text style={styles.eyebrow}>CHAPTER {chapter.index}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        </View>

        {chapter.summary ? (
          <View style={styles.section}>
            <Text style={styles.summaryText}>{chapter.summary}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={() => onExplore(chapter)}
            accessibilityRole="button"
            accessibilityLabel={`Explore ${title} mind map`}
          >
            <Text style={styles.primaryButtonText}>
              🗺 Explore chapter map ({conceptCount})
            </Text>
          </TouchableOpacity>

          {chapter.jump_paragraph_id ? (
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => onJumpToChapter(chapter.jump_paragraph_id as string)}
              accessibilityRole="button"
              accessibilityLabel={`Jump to ${title}`}
            >
              <Text style={styles.secondaryButtonText}>↪ Jump to chapter</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
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
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7c5cbf",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    color: "#171715",
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  summaryText: {
    fontSize: 14,
    color: "#6d6860",
    lineHeight: 22,
  },
  actions: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 10,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButton: {
    backgroundColor: "#7c5cbf",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#efe9f7",
  },
  secondaryButtonText: {
    color: "#4a3a73",
    fontSize: 15,
    fontWeight: "600",
  },
});
