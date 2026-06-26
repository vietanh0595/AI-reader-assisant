import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { MindMapScreen } from "./MindMapScreen";
import { MindMapData } from "../rag/mindmapTypes";

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
  onNodeTap: jest.fn(),
};

const READY_PROPS = {
  ...baseProps,
  status: "ready" as const,
  data: FIXTURE_DATA,
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
  const { getByText, toJSON } = await render(
    <MindMapScreen
      {...baseProps}
      status="ready"
      data={FIXTURE_DATA}
    />,
  );
  // Book title shown in native header Text
  getByText("Atomic Habits");
  // Legend labels (native Text elements)
  getByText("theme");
  getByText("concept");
  getByText("argument");
  getByText("character");
  // SVG node label text is rendered inside RNSVGText which is not queryable
  // via getByText — verify the full tree via snapshot instead
  expect(toJSON()).toMatchSnapshot();
});

test("calls onNodeTap when a node is pressed", async () => {
  const onNodeTap = jest.fn();
  const { getByTestId } = await render(
    <MindMapScreen {...READY_PROPS} onNodeTap={onNodeTap} />,
  );
  fireEvent.press(getByTestId("mindmap-node-n1"));
  expect(onNodeTap).toHaveBeenCalledWith(FIXTURE_DATA.nodes[0]);
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
      onNodeTap={jest.fn()}
    />,
  );
  expect(getByText(/no concepts extracted/i)).toBeTruthy();
});
