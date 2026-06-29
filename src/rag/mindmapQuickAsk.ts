import { MindMapChapter, MindMapNode } from "./mindmapTypes";

// Preset "quick ask" prompts surfaced as chips on the mind-map tap sheets. Tapping
// a chip silently injects the node/chapter context into a ready-made question and
// sends it to the Ask thread — the user never has to phrase it themselves.

export type NodeQuickAskIntent = "detail" | "examples" | "why";
export type ChapterQuickAskIntent = "takeaways" | "argument" | "examples";

// A built quick-ask: the question text plus whether the answerer may reach
// beyond the book into real-world general knowledge (clearly labeled). Example
// and explanatory intents are hybrid; summary/argument intents stay grounded.
export interface QuickAsk {
  question: string;
  allowGeneralKnowledge: boolean;
}

export const NODE_QUICK_ASKS: { intent: NodeQuickAskIntent; label: string }[] = [
  { intent: "detail", label: "More detail" },
  { intent: "examples", label: "Examples" },
  { intent: "why", label: "Why it matters" },
];

export const CHAPTER_QUICK_ASKS: {
  intent: ChapterQuickAskIntent;
  label: string;
}[] = [
  { intent: "takeaways", label: "Key takeaways" },
  { intent: "argument", label: "Main argument" },
  { intent: "examples", label: "Examples" },
];

export function nodeQuickAskQuestion(
  node: MindMapNode,
  intent: NodeQuickAskIntent,
): QuickAsk {
  const label = node.label;
  switch (intent) {
    case "detail":
      return {
        question: `Tell me more about "${label}", as discussed in this book and beyond.`,
        allowGeneralKnowledge: true,
      };
    case "examples":
      return {
        question: `Give me specific examples of "${label}", both from this book and from the real world.`,
        allowGeneralKnowledge: true,
      };
    case "why":
      return {
        question: `Why does "${label}" matter, in this book and more broadly?`,
        allowGeneralKnowledge: true,
      };
  }
}

export function chapterQuickAskQuestion(
  chapter: MindMapChapter,
  intent: ChapterQuickAskIntent,
): QuickAsk {
  const title = chapter.title ?? `Chapter ${chapter.index}`;
  switch (intent) {
    case "takeaways":
      return {
        question: `What are the key takeaways from "${title}"?`,
        allowGeneralKnowledge: false,
      };
    case "argument":
      return {
        question: `What is the main argument of "${title}"?`,
        allowGeneralKnowledge: false,
      };
    case "examples":
      return {
        question: `Give me specific examples for "${title}", both from this book and from the real world.`,
        allowGeneralKnowledge: true,
      };
  }
}
