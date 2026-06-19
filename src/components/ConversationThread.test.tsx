import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConversationThread } from './ConversationThread';

const metrics = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const renderThread = (ui: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

const baseProps = {
  turns: [
    { id: 't1', role: 'user' as const, text: 'best strategy?', createdAt: 'now' },
    { id: 't2', role: 'assistant' as const, text: 'Start early.', createdAt: 'now',
      sources: [{ id: 's0-0', paragraphId: 'p-1', chapterTitle: 'Diversification', excerpt: 'ex',
                  pageIndex: 221, pageLabel: undefined, sourceRef: { source: 'epub' as const } }] },
  ],
  includeWholeBook: true, selectedText: undefined as string | undefined, isLoading: false,
  onSubmit: jest.fn(), onToggleWholeBook: jest.fn(), onClear: jest.fn(),
  onNavigateSource: jest.fn(), onClearSelection: jest.fn(), onClose: jest.fn(),
};

test('renders user and assistant turns with citation chips', async () => {
  const { getByText } = await renderThread(<ConversationThread {...baseProps} />);
  getByText('best strategy?');
  getByText('Start early.');
  getByText('Diversification');
});

test('tapping a source calls onNavigateSource with the paragraph id', async () => {
  const onNavigateSource = jest.fn();
  const { getByText } = await renderThread(<ConversationThread {...baseProps} onNavigateSource={onNavigateSource} />);
  fireEvent.press(getByText('Diversification'));
  expect(onNavigateSource).toHaveBeenCalledWith('p-1', 'ex');
});

test('shows a context chip when selectedText is present', async () => {
  const { getByText } = await renderThread(<ConversationThread {...baseProps} selectedText="callable bonds" />);
  getByText(/Asking about/);
});

test('shows an error message when one is provided', async () => {
  const { getByText } = await renderThread(
    <ConversationThread {...baseProps} error="Your sign-in has expired." />,
  );
  getByText('Your sign-in has expired.');
});

test('does not submit while loading', async () => {
  const onSubmit = jest.fn();
  const { getByPlaceholderText, getByLabelText } = await renderThread(
    <ConversationThread {...baseProps} isLoading={true} onSubmit={onSubmit} />,
  );
  fireEvent.changeText(getByPlaceholderText('Ask a follow-up…'), 'another question');
  fireEvent.press(getByLabelText('Send'));
  expect(onSubmit).not.toHaveBeenCalled();
});
