import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@react-native-harness/tools';

const cacheLogger = logger.child('cache');

// Directories that never contain a repo's own lockfiles/config, only vendored
// or generated copies of them (e.g. a dependency's own package-lock.json
// under node_modules). Skipping these is the correctness fix over today's
// `hashFiles('**/pnpm-lock.yaml', ...)` glob, which matches inside
// node_modules too.
const SKIPPED_DIRNAMES = new Set(['node_modules', '.git', 'dist', 'build']);

export const METRO_KEY_FILENAMES: readonly string[] = [
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'metro.config.js',
  'metro.config.cjs',
  'metro.config.mjs',
  'metro.config.ts',
  'babel.config.js',
  'babel.config.cjs',
  'babel.config.mjs',
  'babel.config.ts',
  'babel.config.json',
];

const METRO_KEY_FILENAME_SET = new Set(METRO_KEY_FILENAMES);

interface KeyFileMatch {
  relativePath: string;
  content: Buffer;
}

const collectKeyFiles = (
  repoRoot: string,
  directory: string,
  matches: KeyFileMatch[]
): void => {
  for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
    if (dirent.isDirectory()) {
      if (SKIPPED_DIRNAMES.has(dirent.name)) {
        continue;
      }
      collectKeyFiles(repoRoot, path.join(directory, dirent.name), matches);
    } else if (dirent.isFile() && METRO_KEY_FILENAME_SET.has(dirent.name)) {
      const fullPath = path.join(directory, dirent.name);
      matches.push({
        relativePath: path
          .relative(repoRoot, fullPath)
          .split(path.sep)
          .join('/'),
        content: fs.readFileSync(fullPath),
      });
    }
  }
};

const hashKeyFiles = (matches: KeyFileMatch[]): string => {
  const hash = createHash('sha256');

  for (const match of matches
    .slice()
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1))) {
    hash.update(match.relativePath);
    hash.update('\0');
    hash.update(match.content);
    hash.update('\0');
  }

  return hash.digest('hex');
};

export const computeMetroStaticInputs = (options: {
  repoRoot: string;
  bundlerMetroVersion: string;
  salt?: string;
}): Record<string, string> => {
  try {
    const matches: KeyFileMatch[] = [];
    collectKeyFiles(options.repoRoot, options.repoRoot, matches);

    return {
      lockfileHash: hashKeyFiles(matches),
      bundlerMetroVersion: options.bundlerMetroVersion,
      ...(options.salt ? { salt: options.salt } : {}),
    };
  } catch (error) {
    cacheLogger.warn(
      `Failed to compute Metro cache key inputs for "${options.repoRoot}". Falling back to an always-miss key.`,
      error
    );
    return {
      lockfileHash: 'unavailable',
      bundlerMetroVersion: options.bundlerMetroVersion,
    };
  }
};
