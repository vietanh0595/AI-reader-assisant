import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { NodeTapSheet } from "./NodeTapSheet";
import { MindMapNode } from "../rag/mindmapTypes";

const FIXTURE_NODE: MindMapNode = {
  id: "n1",
  label: "Habit Loop",
  type: "concept",
  summary: "The four-step pattern: cue, craving, response, reward.",
  importance: 0.95,
  passage_ids: ["p1", "p2"],
  chapter: null,
};

const BASE_PROPS = {
  bookId: "book-1",
  onClose: jest.fn(),
  onJumpToPassage: jest.fn(),
  onAsk: jest.fn(),
};

afterEach(() => {
  jest.clearAllMocks();
});

test("returns null when node is null", async () => {
  const { toJSON } = await render(
    <NodeTapSheet {...BASE_PROPS} node={null} />,
  );
  expect(toJSON()).toBeNull();
});

test("renders node label when node is provided", async () => {
  await render(<NodeTapSheet {...BASE_PROPS} node={FIXTURE_NODE} />);
  expect(screen.getByText("Habit Loop")).toBeTruthy();
});

test("renders type badge", async () => {
  await render(<NodeTapSheet {...BASE_PROPS} node={FIXTURE_NODE} />);
  expect(screen.getByText("concept")).toBeTruthy();
});

test("renders passage rows", async () => {
  await render(<NodeTapSheet {...BASE_PROPS} node={FIXTURE_NODE} />);
  expect(screen.getByText("Passage: p1")).toBeTruthy();
  expect(screen.getByText("Passage: p2")).toBeTruthy();
});

test("calls onAsk when Ask button is pressed", async () => {
  const onAsk = jest.fn();
  await render(<NodeTapSheet {...BASE_PROPS} node={FIXTURE_NODE} onAsk={onAsk} />);
  fireEvent.press(screen.getByRole("button", { name: /ask about habit loop/i }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(onAsk).toHaveBeenCalledWith(FIXTURE_NODE);
});

test("calls onJumpToPassage when a passage row is tapped", async () => {
  const onJumpToPassage = jest.fn();
  await render(
    <NodeTapSheet {...BASE_PROPS} node={FIXTURE_NODE} onJumpToPassage={onJumpToPassage} />,
  );
  fireEvent.press(screen.getByRole("button", { name: "Passage p1" }));
  expect(onJumpToPassage).toHaveBeenCalledTimes(1);
  expect(onJumpToPassage).toHaveBeenCalledWith("p1");
});

test("calls onClose when backdrop is pressed", async () => {
  const onClose = jest.fn();
  const { getByTestId } = await render(
    <NodeTapSheet node={FIXTURE_NODE} bookId="b1" onClose={onClose} onJumpToPassage={jest.fn()} onAsk={jest.fn()} />,
  );
  fireEvent.press(getByTestId("nodeTapSheet-backdrop"));
  expect(onClose).toHaveBeenCalled();
});

test("updates content when node changes", async () => {
  const OTHER_NODE: MindMapNode = { ...FIXTURE_NODE, id: "n2", label: "Identity Change", type: "theme" };
  const { getByText, rerender } = await render(
    <NodeTapSheet node={FIXTURE_NODE} bookId="b1" onClose={jest.fn()} onJumpToPassage={jest.fn()} onAsk={jest.fn()} />,
  );
  expect(getByText("Habit Loop")).toBeTruthy();
  await rerender(<NodeTapSheet node={OTHER_NODE} bookId="b1" onClose={jest.fn()} onJumpToPassage={jest.fn()} onAsk={jest.fn()} />);
  expect(getByText("Identity Change")).toBeTruthy();
});
