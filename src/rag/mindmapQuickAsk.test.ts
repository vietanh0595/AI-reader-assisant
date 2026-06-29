import {
  CHAPTER_QUICK_ASKS,
  NODE_QUICK_ASKS,
  chapterQuickAskQuestion,
  nodeQuickAskQuestion,
} from "./mindmapQuickAsk";
import { MindMapChapter, MindMapNode } from "./mindmapTypes";

const NODE: MindMapNode = {
  id: "n1",
  label: "Compound Interest",
  type: "concept",
  summary: "Interest on interest.",
  importance: 0.9,
  passage_ids: ["p1"],
  chapter: 2,
};

const CHAPTER: MindMapChapter = {
  index: 3,
  id: "ch3",
  title: "Bonds and ETFs",
  summary: null,
  jump_paragraph_id: "p10",
  nodes: [],
  edges: [],
};

test("node questions embed the node label", () => {
  expect(nodeQuickAskQuestion(NODE, "detail").question).toContain('"Compound Interest"');
  expect(nodeQuickAskQuestion(NODE, "examples").question).toContain('"Compound Interest"');
  expect(nodeQuickAskQuestion(NODE, "why").question).toContain('"Compound Interest"');
});

test("chapter questions embed the chapter title", () => {
  expect(chapterQuickAskQuestion(CHAPTER, "takeaways").question).toContain('"Bonds and ETFs"');
  expect(chapterQuickAskQuestion(CHAPTER, "argument").question).toContain('"Bonds and ETFs"');
  expect(chapterQuickAskQuestion(CHAPTER, "examples").question).toContain('"Bonds and ETFs"');
});

test("chapter questions fall back to the index when title is null", () => {
  const untitled = { ...CHAPTER, title: null };
  expect(chapterQuickAskQuestion(untitled, "takeaways").question).toContain('"Chapter 3"');
});

test("node intents are all hybrid (book + real-world)", () => {
  expect(nodeQuickAskQuestion(NODE, "detail").allowGeneralKnowledge).toBe(true);
  expect(nodeQuickAskQuestion(NODE, "examples").allowGeneralKnowledge).toBe(true);
  expect(nodeQuickAskQuestion(NODE, "why").allowGeneralKnowledge).toBe(true);
});

test("chapter examples is hybrid; takeaways and argument stay grounded", () => {
  expect(chapterQuickAskQuestion(CHAPTER, "examples").allowGeneralKnowledge).toBe(true);
  expect(chapterQuickAskQuestion(CHAPTER, "takeaways").allowGeneralKnowledge).toBe(false);
  expect(chapterQuickAskQuestion(CHAPTER, "argument").allowGeneralKnowledge).toBe(false);
});

test("every preset intent produces a non-empty question", () => {
  for (const { intent } of NODE_QUICK_ASKS) {
    expect(nodeQuickAskQuestion(NODE, intent).question.length).toBeGreaterThan(0);
  }
  for (const { intent } of CHAPTER_QUICK_ASKS) {
    expect(chapterQuickAskQuestion(CHAPTER, intent).question.length).toBeGreaterThan(0);
  }
});
