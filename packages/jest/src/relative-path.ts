import path from 'node:path';

/**
 * Returns `filePath` relative to `rootDir`, always using `/` as the separator.
 *
 * These paths leave the host (they are sent to the device and used in Metro
 * bundle URLs and plugin hooks), so they must not depend on the host OS.
 */
export const toRelativePosixPath = (rootDir: string, filePath: string): string =>
  path.relative(rootDir, filePath).split(path.sep).join('/');
