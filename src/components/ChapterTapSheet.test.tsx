import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ChapterTapSheet } from "./ChapterTapSheet";
import { MindMapChapter } from "../rag/mindmapTypes";

const CHAPTER: MindMapChapter = {
  index: 2,
  id: "ch2",
  title: "Compounding",
  summary: "Small gains add up.",
  jump_paragraph_id: "p42",
  nodes: [
    {
      id: "ch2-n1",
      label: "1% better",
      type: "concept",
      summary: "Marginal gains.",
      importance: 0.9,
      passage_ids: ["p42"],
      chapter: 2,
    },
  ],
  edges: [],
};

const BASE = {
  onClose: jest.fn(),
  onJumpToChapter: jest.fn(),
  onExplore: jest.fn(),
  onQuickAsk: jest.fn(),
};

afterEach(() => jest.clearAllMocks());

test("returns null when chapter is null", async () => {
  const { toJSON } = await render(<ChapterTapSheet {...BASE} chapter={null} />);
  expect(toJSON()).toBeNull();
});

test("renders chapter title and summary", async () => {
  await render(<ChapterTapSheet {...BASE} chapter={CHAPTER} />);
  expect(screen.getByText("Compounding")).toBeTruthy();
  expect(screen.getByText("Small gains add up.")).toBeTruthy();
  expect(screen.getByText("CHAPTER 2")).toBeTruthy();
});

test("calls onExplore when Explore is pressed", async () => {
  const onExplore = jest.fn();
  await render(
    <ChapterTapSheet {...BASE} chapter={CHAPTER} onExplore={onExplore} />,
  );
  fireEvent.press(screen.getByText(/Explore chapter map/));
  expect(onExplore).toHaveBeenCalledWith(CHAPTER);
});

test("hides Explore button when onExplore is not provided", async () => {
  await render(
    <ChapterTapSheet {...BASE} chapter={CHAPTER} onExplore={undefined} />,
  );
  expect(screen.queryByText(/Explore chapter map/)).toBeNull();
});

test("calls onQuickAsk with a context-injected question when a chip is pressed", async () => {
  const onQuickAsk = jest.fn();
  await render(
    <ChapterTapSheet {...BASE} chapter={CHAPTER} onQuickAsk={onQuickAsk} />,
  );
  fireEvent.press(screen.getByText("Key takeaways"));
  expect(onQuickAsk).toHaveBeenCalledWith(
    'What are the key takeaways from "Compounding"?',
    false,
  );
});

test("Examples chip asks with general knowledge allowed", async () => {
  const onQuickAsk = jest.fn();
  await render(
    <ChapterTapSheet {...BASE} chapter={CHAPTER} onQuickAsk={onQuickAsk} />,
  );
  fireEvent.press(screen.getByText("Examples"));
  expect(onQuickAsk).toHaveBeenCalledWith(expect.any(String), true);
});

test("calls onJumpToChapter with the chapter's paragraph id", async () => {
  const onJumpToChapter = jest.fn();
  await render(
    <ChapterTapSheet
      {...BASE}
      chapter={CHAPTER}
      onJumpToChapter={onJumpToChapter}
    />,
  );
  fireEvent.press(screen.getByText("↪ Jump to chapter"));
  expect(onJumpToChapter).toHaveBeenCalledWith("p42");
});

test("hides the jump button when there is no jump target", async () => {
  await render(
    <ChapterTapSheet
      {...BASE}
      chapter={{ ...CHAPTER, jump_paragraph_id: null }}
    />,
  );
  expect(screen.queryByText("↪ Jump to chapter")).toBeNull();
});

test("calls onClose when the backdrop is pressed", async () => {
  const onClose = jest.fn();
  const { getByTestId } = await render(
    <ChapterTapSheet {...BASE} chapter={CHAPTER} onClose={onClose} />,
  );
  fireEvent.press(getByTestId("chapterTapSheet-backdrop"));
  expect(onClose).toHaveBeenCalled();
});
