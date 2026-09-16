import { fireEvent, render } from '@testing-library/react-native';
import { DEFAULT_REASON, SignInSheet } from './SignInSheet';

test('starts hosted sign-in', async () => {
  const onSignIn = jest.fn();
  const screen = await render(<SignInSheet error={null} isLoading={false} onClose={jest.fn()} onSignIn={onSignIn} />);
  fireEvent.press(screen.getByRole('button', { name: 'Continue to sign in' }));
  expect(onSignIn).toHaveBeenCalledTimes(1);
});

test('shows an error message when provided', async () => {
  const screen = await render(
    <SignInSheet error="Sign-in failed." isLoading={false} onClose={jest.fn()} onSignIn={jest.fn()} />,
  );
  expect(screen.getByText('Sign-in failed.')).toBeTruthy();
});

test('disables the sign-in button while loading', async () => {
  const onSignIn = jest.fn();
  const screen = await render(<SignInSheet error={null} isLoading={true} onClose={jest.fn()} onSignIn={onSignIn} />);
  const button = screen.getByRole('button', { name: 'Continue to sign in' });
  fireEvent.press(button);
  expect(onSignIn).not.toHaveBeenCalled();
});

test('calls onClose when the close button is pressed', async () => {
  const onClose = jest.fn();
  const screen = await render(<SignInSheet error={null} isLoading={false} onClose={onClose} onSignIn={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('explains why it opened when there is a specific reason', async () => {
  // A fixed sentence about importing and scanning was shown for every trigger, so
  // a refused delete explained the camera instead of the delete.
  const screen = await render(
    <SignInSheet
      error={null}
      isLoading={false}
      onClose={jest.fn()}
      onSignIn={jest.fn()}
      reason="Deleting this book needs you signed in."
    />,
  );

  expect(screen.getByText('Deleting this book needs you signed in.')).toBeTruthy();
  expect(screen.queryByText(DEFAULT_REASON)).toBeNull();
});

test('falls back to the general explanation when there is no specific one', async () => {
  const screen = await render(
    <SignInSheet error={null} isLoading={false} onClose={jest.fn()} onSignIn={jest.fn()} />,
  );

  expect(screen.getByText(DEFAULT_REASON)).toBeTruthy();
});
