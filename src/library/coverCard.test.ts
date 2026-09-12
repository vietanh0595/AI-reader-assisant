import { COVER_CARD_COLORS, pickCoverCardColor } from './coverCard';

test('the same book always gets the same colour', () => {
  // A library whose colours reshuffle on every launch reads as broken.
  expect(pickCoverCardColor('The Gold-Bug')).toBe(pickCoverCardColor('The Gold-Bug'));
});

test('always returns a colour from the palette', () => {
  const titles = ['A', 'The Raven', 'Investing 101', '', '한국어', '📚'];

  for (const title of titles) {
    expect(COVER_CARD_COLORS).toContain(pickCoverCardColor(title));
  }
});

test('different books do not all land on one colour', () => {
  const titles = ['The Raven', 'The Gold-Bug', 'Investing 101', 'Deep Work', 'Thinking Fast'];
  const used = new Set(titles.map(pickCoverCardColor));

  expect(used.size).toBeGreaterThan(1);
});

test('a book with no title still gets a card rather than crashing', () => {
  expect(COVER_CARD_COLORS).toContain(pickCoverCardColor(''));
});
