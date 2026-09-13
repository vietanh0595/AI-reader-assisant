import { toAbsoluteAppFileUri, toStoredAppFilePath } from './appFilePath';

const dirA = 'file:///var/mobile/Containers/Data/Application/AAAA-1111/Documents/';
const dirB = 'file:///var/mobile/Containers/Data/Application/BBBB-2222/Documents/';

test('stores a path with no install-specific part in it', () => {
  // The container UUID changes whenever a new build is installed, so anything
  // saved with it in becomes a path to the previous install.
  const stored = toStoredAppFilePath(`${dirA}covers/book-1.jpg`, dirA);

  expect(stored).toBe('covers/book-1.jpg');
  expect(stored).not.toContain('AAAA-1111');
});

test('resolves a stored path against wherever the app lives now', () => {
  expect(toAbsoluteAppFileUri('covers/book-1.jpg', dirB)).toBe(`${dirB}covers/book-1.jpg`);
});

test('survives the app being reinstalled somewhere else', () => {
  const stored = toStoredAppFilePath(`${dirA}covers/book-1.jpg`, dirA);

  expect(toAbsoluteAppFileUri(stored, dirB)).toBe(`${dirB}covers/book-1.jpg`);
});

test('heals a path saved by an older version of the app', () => {
  // Books imported before this fix hold a full path into a container that may no
  // longer exist. Re-anchoring it is the difference between the covers coming back
  // and the reader having to re-import every book.
  expect(toAbsoluteAppFileUri(`${dirA}covers/book-1.jpg`, dirB)).toBe(`${dirB}covers/book-1.jpg`);
});

test('leaves a path that is already correct alone', () => {
  expect(toAbsoluteAppFileUri(`${dirB}images/7/3.png`, dirB)).toBe(`${dirB}images/7/3.png`);
});

test('passes through when there is nothing to resolve', () => {
  expect(toAbsoluteAppFileUri(undefined, dirB)).toBeUndefined();
  expect(toStoredAppFilePath(undefined, dirA)).toBeUndefined();
});

test('does not mangle a path when the app directory is unknown', () => {
  expect(toAbsoluteAppFileUri('covers/book-1.jpg', null)).toBe('covers/book-1.jpg');
  expect(toStoredAppFilePath(`${dirA}covers/book-1.jpg`, null)).toBe(`${dirA}covers/book-1.jpg`);
});
