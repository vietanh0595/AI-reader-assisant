// Everything the app writes lives under its Documents directory, and the absolute
// path to that directory contains an install-specific identifier:
//
//   file:///var/mobile/Containers/Data/Application/<UUID>/Documents/
//
// That identifier changes when a new build is installed, so a saved absolute path
// points into the previous install and the file appears to have vanished. Apple
// documents this; the fix is to persist paths relative to the directory and resolve
// them at the moment of use.
const DOCUMENTS_MARKER = '/Documents/';

/** The form to persist: relative to the app's Documents directory. */
export function toStoredAppFilePath(
  uri?: string,
  directory?: string | null,
): string | undefined {
  if (!uri || !directory) {
    return uri;
  }

  return uri.startsWith(directory) ? uri.slice(directory.length) : uri;
}

/**
 * The form to use: an absolute path under the app's current Documents directory.
 *
 * An already-absolute input is re-anchored rather than trusted, which heals paths
 * written before this existed — otherwise every book imported by an earlier build
 * would need re-importing to get its cover and figures back.
 */
export function toAbsoluteAppFileUri(
  stored?: string,
  directory?: string | null,
): string | undefined {
  if (!stored || !directory) {
    return stored;
  }

  if (stored.startsWith(directory)) {
    return stored;
  }

  const markerIndex = stored.indexOf(DOCUMENTS_MARKER);
  const relative =
    markerIndex >= 0 ? stored.slice(markerIndex + DOCUMENTS_MARKER.length) : stored;

  return `${directory}${relative}`;
}
