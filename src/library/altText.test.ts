import { isMeaningfulAltText } from './altText';

test('a real description is worth indexing', () => {
  expect(isMeaningfulAltText('Alice in the Room of the Duchess.')).toBe(true);
  expect(isMeaningfulAltText('Diagram of the Krebs cycle')).toBe(true);
});

test('a generic placeholder is not', () => {
  // Peter Rabbit labels all 29 of its plates "[Illustration]". Indexing that
  // phrase 29 times gives the AI something retrievable that says nothing.
  expect(isMeaningfulAltText('[Illustration]')).toBe(false);
  expect(isMeaningfulAltText('Illustration')).toBe(false);
  expect(isMeaningfulAltText('image')).toBe(false);
  expect(isMeaningfulAltText('Cover Image')).toBe(false);
  expect(isMeaningfulAltText('figure')).toBe(false);
});

test('a bare identifier is not', () => {
  // Alice names some plates "Illo1", "Illo2" — a filename, not a description.
  expect(isMeaningfulAltText('Illo1')).toBe(false);
  expect(isMeaningfulAltText('img_0042')).toBe(false);
  expect(isMeaningfulAltText('plate01_th.jpg')).toBe(false);
});

test('nothing at all is nothing', () => {
  expect(isMeaningfulAltText('')).toBe(false);
  expect(isMeaningfulAltText('   ')).toBe(false);
});

test('a short but real caption survives', () => {
  // The rule must not be so eager that it eats genuine short captions.
  expect(isMeaningfulAltText('The White Rabbit')).toBe(true);
  expect(isMeaningfulAltText('Fig. 3: market depth')).toBe(true);
});
