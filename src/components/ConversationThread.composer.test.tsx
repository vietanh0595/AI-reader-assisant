import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConversationThread } from './ConversationThread';

// Deliberately a separate file from ConversationThread.test.tsx. Renders in
// that suite are not torn down between tests (RNTL v14's cleanup is async and
// the suite's render helper is awaited), so a query in a test queued behind
// several earlier renders fails to find elements that are demonstrably on
// screen. Isolating these keeps them honest without papering over it.

const metrics = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const baseProps = {
  turns: [
    { id: 't1', role: 'user' as const, text: 'best strategy?', createdAt: 'now' },
    { id: 't2', role: 'assistant' as const, text: 'Start early.', createdAt: 'now' },
  ],
  includeWholeBook: true,
  selectedText: undefined as string | undefined,
  isLoading: false,
  onSubmit: jest.fn(),
  onToggleWholeBook: jest.fn(),
  onClear: jest.fn(),
  onNavigateSource: jest.fn(),
  onClearSelection: jest.fn(),
  onClose: jest.fn(),
  onSaveTurn: jest.fn(),
  savedTurnIds: new Set<string>(),
};

const renderComposer = async (props: Partial<typeof baseProps> = {}) => {
  const result = await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ConversationThread {...baseProps} {...props} />
    </SafeAreaProvider>,
  );
  return result.getByPlaceholderText('Ask a follow-up…');
};

const flatten = (style: unknown) =>
  Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style as Record<string, unknown>);

// A long question used to run off the right edge of a single-line input,
// scrolling its own opening words out of sight, so the reader could not check
// what they were about to send.
test('the composer wraps long questions instead of scrolling them sideways', async () => {
  const input = await renderComposer();
  expect(input.props.multiline).toBe(true);
});

test('the composer stops growing at a cap rather than swallowing the thread', async () => {
  const input = await renderComposer();
  expect(flatten(input.props.style).maxHeight).toBeGreaterThan(0);
});

// Return still sends. Wrapping was the ask; a multiline input otherwise turns
// the return key into a newline, silently changing how questions are sent.
test('pressing return still submits the question', async () => {
  const onSubmit = jest.fn();
  const input = await renderComposer({ onSubmit });
  // fireEvent is awaited for the same reason render is in this suite: the
  // draft state has to commit before submitEditing reads it.
  await fireEvent.changeText(input, 'why does this matter?');
  await fireEvent(input, 'submitEditing');
  // The second argument carries a quoted-answer chip; there is none here.
  expect(onSubmit).toHaveBeenCalledWith('why does this matter?', undefined);
  expect(input.props.blurOnSubmit).toBe(true);
});
