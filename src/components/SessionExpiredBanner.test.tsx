import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionExpiredBanner } from './SessionExpiredBanner';

const metrics = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const renderBanner = (ui: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

test('renders nothing when the session has not expired', async () => {
  const screen = await renderBanner(
    <SessionExpiredBanner sessionExpired={false} onDismiss={jest.fn()} onSignIn={jest.fn()} />,
  );
  expect(
    screen.queryByText(
      'Your sign-in has expired. Sign in again to ask questions and sync your library.',
    ),
  ).toBeNull();
});

test('shows the reminder and starts sign-in when tapped', async () => {
  const onSignIn = jest.fn();
  const screen = await renderBanner(
    <SessionExpiredBanner sessionExpired={true} onDismiss={jest.fn()} onSignIn={onSignIn} />,
  );
  expect(
    screen.getByText(
      'Your sign-in has expired. Sign in again to ask questions and sync your library.',
    ),
  ).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(onSignIn).toHaveBeenCalledTimes(1);
});

test('calls onDismiss when the dismiss button is pressed', async () => {
  const onDismiss = jest.fn();
  const screen = await renderBanner(
    <SessionExpiredBanner sessionExpired={true} onDismiss={onDismiss} onSignIn={jest.fn()} />,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
