import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ConversationThread } from './ConversationThread';

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
  const { getByText } = await render(<ConversationThread {...baseProps} />);
  getByText('best strategy?');
  getByText('Start early.');
  getByText('Diversification');
});

test('tapping a source calls onNavigateSource with the paragraph id', async () => {
  const onNavigateSource = jest.fn();
  const { getByText } = await render(<ConversationThread {...baseProps} onNavigateSource={onNavigateSource} />);
  fireEvent.press(getByText('Diversification'));
  expect(onNavigateSource).toHaveBeenCalledWith('p-1');
});

test('shows a context chip when selectedText is present', async () => {
  const { getByText } = await render(<ConversationThread {...baseProps} selectedText="callable bonds" />);
  getByText(/Asking about/);
});

test('does not submit while loading', async () => {
  const onSubmit = jest.fn();
  const { getByPlaceholderText, getByLabelText } = await render(
    <ConversationThread {...baseProps} isLoading={true} onSubmit={onSubmit} />,
  );
  fireEvent.changeText(getByPlaceholderText('Ask a follow-up…'), 'another question');
  fireEvent.press(getByLabelText('Send'));
  expect(onSubmit).not.toHaveBeenCalled();
});
