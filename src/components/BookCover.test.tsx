import React from 'react';
import { render } from '@testing-library/react-native';
import { BookCover } from './BookCover';

test('shows the real cover when the book has one', async () => {
  const screen = await render(
    <BookCover author="Edgar Allan Poe" coverUri="file:///covers/raven.jpg" title="The Raven" />,
  );

  const image = screen.getByLabelText('Cover of The Raven');
  expect(image.props.source).toEqual({ uri: 'file:///covers/raven.jpg' });
});

test('falls back to a title card when there is no cover art', async () => {
  // Some EPUBs genuinely have no cover. A library mixing real covers with grey
  // icons reads as broken; one where every book has something reads as intentional.
  const screen = await render(<BookCover author="Edgar Allan Poe" title="The Raven" />);

  expect(screen.getByText('The Raven')).toBeTruthy();
  expect(screen.getByText('Edgar Allan Poe')).toBeTruthy();
});

test('the title card is not announced twice to a screen reader', async () => {
  const screen = await render(<BookCover author="Edgar Allan Poe" title="The Raven" />);

  expect(screen.queryByLabelText('Cover of The Raven')).toBeNull();
});
