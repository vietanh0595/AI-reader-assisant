import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ErrorInsightCard } from './ErrorInsightCard';

test('shows the failure message', async () => {
  const screen = await render(<ErrorInsightCard message="Check your connection." />);

  expect(screen.getByText('Check your connection.')).toBeTruthy();
});

test('offers a Retry the reader can press', async () => {
  // The chat sheet has always had this. The quick-action card had only the message,
  // so a failed Explain left the reader with nothing to press but the toolbar again.
  const onRetry = jest.fn();
  const screen = await render(
    <ErrorInsightCard message="Check your connection." onRetry={onRetry} />,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('hides Retry when there is nothing to retry', async () => {
  // Some failures are not a re-runnable request — "no readable page context to
  // summarize" is a state problem, and a Retry there would just fail again.
  const screen = await render(<ErrorInsightCard message="Nothing to summarize." />);

  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});
