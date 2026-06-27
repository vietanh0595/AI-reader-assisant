import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { MindMapScreen } from "./MindMapScreen";
import { MindMapChapter, MindMapData } from "../rag/mindmapTypes";

const FIXTURE_DATA: MindMapData = {
  genre: "non-fiction",
  nodes: [
    {
      id: "n1",
      label: "Habit Loop",
      type: "concept",
      summary: "Four-step pattern.",
      importance: 0.95,
      passage_ids: ["p1"],
      chapter: null,
    },
    {
      id: "n2",
      label: "Identity Change",
      type: "theme",
      summary: "Identity shift.",
      importance: 0.85,
      passage_ids: ["p2"],
      chapter: null,
    },
    {
      id: "n3",
      label: "Environment Design",
      type: "concept",
      summary: "Make cues visible.",
      importance: 0.7,
      passage_ids: ["p3"],
      chapter: null,
    },
  ],
  edges: [{ from: "n1", to: "n2", label: "enables" }],
};

const baseProps = {
  bookTitle: "Atomic Habits",
  bookId: "book-1",
  data: null as MindMapData | null,
  error: undefined as string | undefined,
  onClose: jest.fn(),
  onRetry: jest.fn(),
  onJumpToPassage: jest.fn(),
  onAsk: jest.fn(),
};

const READY_PROPS = {
  ...baseProps,
  status: "ready" as const,
  data: FIXTURE_DATA,
};

const CHAPTER_FIXTURE: MindMapChapter = {
  index: 1,
  id: "ch1",
  title: "The Habit Loop",
  summary: "How habits form and stick.",
  jump_paragraph_id: "p10",
  nodes: [
    {
      id: "ch1-n1",
      label: "Cue",
      type: "concept",
      summary: "The trigger.",
      importance: 0.9,
      passage_ids: ["p10"],
      chapter: 1,
    },
    {
      id: "ch1-n2",
      label: "Reward",
      type: "concept",
      summary: "The payoff.",
      importance: 0.7,
      passage_ids: ["p11"],
      chapter: 1,
    },
  ],
  edges: [{ from: "ch1-n1", to: "ch1-n2", label: "leads to" }],
};

const DATA_WITH_CHAPTERS: MindMapData = {
  ...FIXTURE_DATA,
  chapters: [CHAPTER_FIXTURE],
};

const CHAPTER_PROPS = {
  ...baseProps,
  status: "ready" as const,
  data: DATA_WITH_CHAPTERS,
};

test("rendering: generating state shows spinner and label", async () => {
  const { getByText, toJSON } = await render(
    <MindMapScreen {...baseProps} status="generating" />,
  );
  getByText("Generating mind map…");
  expect(toJSON()).toMatchSnapshot();
});

test("rendering: failed state shows title, error and retry button", async () => {
  const { getByText, toJSON } = await render(
    <MindMapScreen
      {...baseProps}
      status="failed"
      error="Network timeout"
    />,
  );
  getByText("Generation failed");
  getByText("Network timeout");
  getByText("Retry");
  expect(toJSON()).toMatchSnapshot();
});

test("rendering: insufficient_content state shows friendly message", async () => {
  const { getByText, toJSON } = await render(
    <MindMapScreen {...baseProps} status="insufficient_content" />,
  );
  getByText("Not enough content");
  expect(toJSON()).toMatchSnapshot();
});

test("rendering: ready state renders SVG with node labels", async () => {
  const { getByText, getAllByText, toJSON } = await render(
    <MindMapScreen
      {...baseProps}
      status="ready"
      data={FIXTURE_DATA}
    />,
  );
  // Book title shown in both the header and the center node
  expect(getAllByText("Atomic Habits").length).toBeGreaterThanOrEqual(1);
  // Legend labels (native Text elements)
  getByText("theme");
  getByText("concept");
  getByText("argument");
  getByText("character");
  // SVG node label text is rendered inside RNSVGText which is not queryable
  // via getByText — verify the full tree via snapshot instead
  expect(toJSON()).toMatchSnapshot();
});

test("tapping a node opens the detail sheet", async () => {
  const { getByTestId, findByText } = await render(
    <MindMapScreen {...READY_PROPS} />,
  );
  fireEvent.press(getByTestId("mindmap-node-n1"));
  // The NodeTapSheet renders the node summary once opened
  expect(await findByText("Four-step pattern.")).toBeTruthy();
});

test("jumping to a passage from the sheet calls onJumpToPassage", async () => {
  const onJumpToPassage = jest.fn();
  const { getByTestId, findByText } = await render(
    <MindMapScreen {...READY_PROPS} onJumpToPassage={onJumpToPassage} />,
  );
  fireEvent.press(getByTestId("mindmap-node-n1"));
  fireEvent.press(await findByText("Passage: p1"));
  expect(onJumpToPassage).toHaveBeenCalledWith("p1");
});

test("shows empty state when ready but no nodes", async () => {
  const { getByText } = await render(
    <MindMapScreen
      bookTitle="Test Book"
      bookId="b1"
      status="ready"
      data={{ genre: "non-fiction", nodes: [], edges: [] }}
      onClose={jest.fn()}
      onRetry={jest.fn()}
      onJumpToPassage={jest.fn()}
      onAsk={jest.fn()}
    />,
  );
  expect(getByText(/no concepts extracted/i)).toBeTruthy();
});

test("no chapter chips when the map has no chapters", async () => {
  const { queryByText } = await render(<MindMapScreen {...READY_PROPS} />);
  expect(queryByText("Chapters")).toBeNull();
});

test("shows Concepts/Chapters chips when chapters are present", async () => {
  const { getByText } = await render(<MindMapScreen {...CHAPTER_PROPS} />);
  getByText("Concepts");
  getByText("Chapters");
});

test("switching to the Chapters tab shows chapter nodes", async () => {
  const { getByTestId, findByTestId } = await render(
    <MindMapScreen {...CHAPTER_PROPS} />,
  );
  fireEvent.press(getByTestId("mindmap-tab-chapters"));
  // The chapter is rendered as a single node (id === chapter id).
  expect(await findByTestId("mindmap-node-ch1")).toBeTruthy();
});

test("tapping a chapter opens the chapter sheet", async () => {
  const { getByTestId, findByTestId, findByText } = await render(
    <MindMapScreen {...CHAPTER_PROPS} />,
  );
  fireEvent.press(getByTestId("mindmap-tab-chapters"));
  fireEvent.press(await findByTestId("mindmap-node-ch1"));
  expect(await findByText("How habits form and stick.")).toBeTruthy();
  expect(await findByText(/Explore chapter map/)).toBeTruthy();
});

test("exploring a chapter drills into its concept map", async () => {
  const { getByText, getByTestId, findByText, findByTestId } = await render(
    <MindMapScreen {...CHAPTER_PROPS} />,
  );
  fireEvent.press(getByTestId("mindmap-tab-chapters"));
  fireEvent.press(await findByTestId("mindmap-node-ch1"));
  fireEvent.press(await findByText(/Explore chapter map/));
  // The chapter's own concept nodes are now rendered.
  expect(await findByTestId("mindmap-node-ch1-n1")).toBeTruthy();
  // Breadcrumb back to chapters.
  getByText(/‹ Chapters/);
});

test("jump to chapter from the sheet calls onJumpToPassage", async () => {
  const onJumpToPassage = jest.fn();
  const { getByTestId, findByTestId, findByText } = await render(
    <MindMapScreen {...CHAPTER_PROPS} onJumpToPassage={onJumpToPassage} />,
  );
  fireEvent.press(getByTestId("mindmap-tab-chapters"));
  fireEvent.press(await findByTestId("mindmap-node-ch1"));
  fireEvent.press(await findByText("↪ Jump to chapter"));
  expect(onJumpToPassage).toHaveBeenCalledWith("p10");
});
