import { resolveMindMapBookId, shouldStartMindMapGeneration } from './mindmapTarget';

test('uses the backend cloud book id for mind map requests', () => {
  const localLibraryId = 'pdf:investing-101-from-stocks-and-bonds-to-etf:2q98e8';
  const cloudBookId = '550e8400-e29b-41d4-a716-446655440000';

  expect(resolveMindMapBookId(localLibraryId, { cloudBookId })).toBe(cloudBookId);
});

test('does not fall back to the local library id when cloud book id is missing', () => {
  const localLibraryId = 'pdf:investing-101-from-stocks-and-bonds-to-etf:2q98e8';

  expect(resolveMindMapBookId(localLibraryId, {})).toBeNull();
});

test('does not regenerate when an existing terminal status should be shown', () => {
  expect(shouldStartMindMapGeneration('failed', false)).toBe(false);
  expect(shouldStartMindMapGeneration('ready', false)).toBe(false);
});

test('regenerates a failed mind map when retry is forced', () => {
  expect(shouldStartMindMapGeneration('failed', true)).toBe(true);
});
