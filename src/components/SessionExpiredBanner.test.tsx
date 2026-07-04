import { fireEvent, render } from '@testing-library/react-native';
import { SessionExpiredBanner } from './SessionExpiredBanner';

test('renders nothing when the session has not expired', async () => {
  const screen = await render(
    <SessionExpiredBanner sessionExpired={false} onDismiss={jest.fn()} onSignIn={jest.fn()} />,
  );
  expect(screen.toJSON()).toBeNull();
});

test('shows the reminder and starts sign-in when tapped', async () => {
  const onSignIn = jest.fn();
  const screen = await render(
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
  const screen = await render(
    <SessionExpiredBanner sessionExpired={true} onDismiss={onDismiss} onSignIn={jest.fn()} />,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
