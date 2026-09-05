import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LibraryDeleteButton } from './LibraryDeleteButton';

test('asks to delete the book it belongs to', async () => {
  const onPress = jest.fn();
  const screen = await render(
    <LibraryDeleteButton bookTitle="The Raven" isDeleting={false} onPress={onPress} />,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Remove The Raven' }));

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('shows it is working while the delete is in flight', async () => {
  // Removing an indexed book waits on a network round-trip. Without this the row
  // looks frozen and the reader taps again.
  const screen = await render(
    <LibraryDeleteButton bookTitle="The Raven" isDeleting onPress={jest.fn()} />,
  );

  expect(screen.getByLabelText('Deleting The Raven')).toBeTruthy();
});

test('cannot be pressed twice while it is already deleting', async () => {
  const onPress = jest.fn();
  const screen = await render(
    <LibraryDeleteButton bookTitle="The Raven" isDeleting onPress={onPress} />,
  );

  await fireEvent.press(screen.getByLabelText('Deleting The Raven'));

  expect(onPress).not.toHaveBeenCalled();
});
