import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BackgroundJobBanner } from './BackgroundJobBanner';

const metrics = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const renderBanner = (ui: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

test('renders nothing when there is no pending notice', async () => {
  const screen = await renderBanner(
    <BackgroundJobBanner notice={null} onDismiss={jest.fn()} onView={jest.fn()} />,
  );
  expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
});

test('shows a ready notice and fires onView', async () => {
  const onView = jest.fn();
  const screen = await renderBanner(
    <BackgroundJobBanner
      notice={{ bookId: 'book-1', bookTitle: 'Deep Work', kind: 'indexing', status: 'ready' }}
      onDismiss={jest.fn()}
      onView={onView}
    />,
  );
  expect(screen.getByText("'Deep Work' is ready")).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'View' }));
  expect(onView).toHaveBeenCalledTimes(1);
});

test('shows a failed indexing notice with the right copy', async () => {
  const screen = await renderBanner(
    <BackgroundJobBanner
      notice={{ bookId: 'book-1', bookTitle: 'Deep Work', kind: 'indexing', status: 'failed' }}
      onDismiss={jest.fn()}
      onView={jest.fn()}
    />,
  );
  expect(screen.getByText("Indexing for 'Deep Work' failed")).toBeTruthy();
});

test('shows a failed mind map notice with the right copy', async () => {
  const screen = await renderBanner(
    <BackgroundJobBanner
      notice={{ bookId: 'book-1', bookTitle: 'Deep Work', kind: 'mindmap', status: 'failed' }}
      onDismiss={jest.fn()}
      onView={jest.fn()}
    />,
  );
  expect(screen.getByText("Mind map for 'Deep Work' failed")).toBeTruthy();
});

test('calls onDismiss when the dismiss button is pressed', async () => {
  const onDismiss = jest.fn();
  const screen = await renderBanner(
    <BackgroundJobBanner
      notice={{ bookId: 'book-1', bookTitle: 'Deep Work', kind: 'indexing', status: 'ready' }}
      onDismiss={onDismiss}
      onView={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
