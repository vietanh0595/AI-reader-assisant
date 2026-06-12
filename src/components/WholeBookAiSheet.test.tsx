import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { WholeBookAiSheet } from './WholeBookAiSheet';
import type { WholeBookAiState } from '../rag/types';

const notEnabledState: WholeBookAiState = {
  acknowledgedBatch: -1,
  progress: 0,
  status: 'not_enabled',
};

const uploadingState: WholeBookAiState = {
  acknowledgedBatch: 2,
  progress: 0.4,
  status: 'uploading',
};

const indexingState: WholeBookAiState = {
  acknowledgedBatch: -1,
  progress: 0.7,
  status: 'indexing',
};

const readyState: WholeBookAiState = {
  acknowledgedBatch: -1,
  progress: 1,
  status: 'ready',
};

const failedState: WholeBookAiState = {
  acknowledgedBatch: -1,
  progress: 0,
  status: 'failed',
  error: 'Indexing failed due to an API error.',
};

test('discloses normalized text upload before enabling', async () => {
  await render(
    <WholeBookAiSheet
      state={notEnabledState}
      onEnable={jest.fn()}
      onRetry={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(screen.getByText(/normalized book text will be uploaded/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /enable whole-book ai/i })).toBeTruthy();
});

test('shows progress bar while uploading', async () => {
  await render(
    <WholeBookAiSheet
      state={uploadingState}
      onEnable={jest.fn()}
      onRetry={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(screen.getByText(/uploading/i)).toBeTruthy();
});

test('shows progress bar while indexing', async () => {
  await render(
    <WholeBookAiSheet
      state={indexingState}
      onEnable={jest.fn()}
      onRetry={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(screen.getByText(/indexing/i)).toBeTruthy();
});

test('shows ready confirmation when complete', async () => {
  await render(
    <WholeBookAiSheet
      state={readyState}
      onEnable={jest.fn()}
      onRetry={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(screen.getByText(/whole-book ai is ready/i)).toBeTruthy();
});

test('shows error and retry button on failure', async () => {
  const onRetry = jest.fn();
  await render(
    <WholeBookAiSheet
      state={failedState}
      onEnable={jest.fn()}
      onRetry={onRetry}
      onClose={jest.fn()}
    />,
  );
  expect(screen.getByText(/indexing failed/i)).toBeTruthy();
  const retryButton = screen.getByRole('button', { name: /retry/i });
  expect(retryButton).toBeTruthy();
  fireEvent.press(retryButton);
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('calls onEnable when enable button pressed', async () => {
  const onEnable = jest.fn();
  await render(
    <WholeBookAiSheet
      state={notEnabledState}
      onEnable={onEnable}
      onRetry={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByRole('button', { name: /enable whole-book ai/i }));
  expect(onEnable).toHaveBeenCalledTimes(1);
});

test('calls onClose when close button pressed', async () => {
  const onClose = jest.fn();
  await render(
    <WholeBookAiSheet
      state={notEnabledState}
      onEnable={jest.fn()}
      onRetry={jest.fn()}
      onClose={onClose}
    />,
  );
  fireEvent.press(screen.getByRole('button', { name: /close/i }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
