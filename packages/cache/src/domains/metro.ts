import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@react-native-harness/tools';

const cacheLogger = logger.child('cache');

// Metro resolves its own config by walking UP from the project root (see
// Metro's loadConfig docs), never by scanning the tree downward. Lockfiles in
// a monorepo live at the repo root, i.e. somewhere on projectRoot's ancestor
// chain. So instead of a downward `hashFiles('**/…')`-style walk (which also
// has to dodge node_modules/.git/dist/build to avoid vendored copies), we
// walk upward from projectRoot to repoRoot (inclusive) and hash every
// candidate key file that exists along that chain. Sibling workspace
// packages are never on this chain, so their configs can't spuriously
// invalidate this project's cache key.
const LOCKFILE_NAMES: readonly string[] = [
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

// Metro config candidates: `metro.config.*` at the directory root, plus the
// `.config/metro.*` directory convention Metro also resolves.
const METRO_CONFIG_EXTENSIONS: readonly string[] = [
  'js',
  'cjs',
  'mjs',
  'ts',
  'cts',
  'mts',
  'json',
];
const METRO_CONFIG_NAMES: readonly string[] = METRO_CONFIG_EXTENSIONS.map(
  (extension) => `metro.config.${extension}`
);
const METRO_CONFIG_DIR_NAMES: readonly string[] = METRO_CONFIG_EXTENSIONS.map(
  (extension) => `.config/metro.${extension}`
);

// Babel only resolves root configs named `babel.config.*` (note: no `.ts` —
// Babel does not resolve `babel.config.ts`). File-relative `.babelrc` and the
// `package.json` `babel`/`metro` fields are intentionally out of scope.
const BABEL_CONFIG_NAMES: readonly string[] = [
  'babel.config.json',
  'babel.config.js',
  'babel.config.cjs',
  'babel.config.mjs',
  'babel.config.cts',
];

// Relative-to-examined-directory paths checked at every directory on the
// ancestor chain. All candidates that exist are hashed (rather than
// emulating Metro/Babel's own first-match-wins resolution), which is
// deterministic and strictly more conservative.
export const METRO_KEY_FILENAMES: readonly string[] = [
  ...LOCKFILE_NAMES,
  ...METRO_CONFIG_NAMES,
  ...METRO_CONFIG_DIR_NAMES,
  ...BABEL_CONFIG_NAMES,
];

interface KeyFileMatch {
  relativePath: string;
  content: Buffer;
}

/**
 * Directories to examine: projectRoot and every ancestor directory up to and
 * including repoRoot. Defensive: if projectRoot isn't inside repoRoot (or
 * repoRoot can't be related to it), fall back to examining projectRoot alone
 * rather than guessing.
 */
const collectAncestorDirectories = (
  projectRoot: string,
  repoRoot: string
): string[] => {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedRepoRoot = path.resolve(repoRoot);

  if (resolvedProjectRoot === resolvedRepoRoot) {
    return [resolvedProjectRoot];
  }

  const relative = path.relative(resolvedRepoRoot, resolvedProjectRoot);
  const isProjectRootInsideRepoRoot =
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative);

  if (!isProjectRootInsideRepoRoot) {
    return [resolvedProjectRoot];
  }

  const directories: string[] = [];
  let current = resolvedProjectRoot;
  for (;;) {
    directories.push(current);
    if (current === resolvedRepoRoot) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      // Reached the filesystem root without hitting repoRoot; defensive
      // guard against an infinite loop.
      break;
    }
    current = parent;
  }

  return directories;
};

const collectKeyFiles = (
  directories: readonly string[],
  repoRoot: string
): KeyFileMatch[] => {
  const matches: KeyFileMatch[] = [];

  for (const directory of directories) {
    for (const candidate of METRO_KEY_FILENAMES) {
      const fullPath = path.join(directory, candidate);

      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        continue;
      }

      matches.push({
        relativePath: path
          .relative(repoRoot, fullPath)
          .split(path.sep)
          .join('/'),
        content: fs.readFileSync(fullPath),
      });
    }
  }

  return matches;
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
  projectRoot: string;
  repoRoot: string;
  bundlerMetroVersion: string;
  salt?: string;
}): Record<string, string> => {
  try {
    const resolvedProjectRoot = path.resolve(options.projectRoot);
    const resolvedRepoRoot = path.resolve(options.repoRoot);

    // Validate both roots exist so a missing directory degrades to the
    // always-miss fallback below instead of silently hashing zero files.
    if (!fs.statSync(resolvedProjectRoot).isDirectory()) {
      throw new Error(
        `projectRoot "${resolvedProjectRoot}" is not a directory`
      );
    }
    if (!fs.statSync(resolvedRepoRoot).isDirectory()) {
      throw new Error(`repoRoot "${resolvedRepoRoot}" is not a directory`);
    }

    const directories = collectAncestorDirectories(
      resolvedProjectRoot,
      resolvedRepoRoot
    );
    const matches = collectKeyFiles(directories, resolvedRepoRoot);

    return {
      lockfileHash: hashKeyFiles(matches),
      bundlerMetroVersion: options.bundlerMetroVersion,
      ...(options.salt ? { salt: options.salt } : {}),
    };
  } catch (error) {
    cacheLogger.warn(
      `Failed to compute Metro cache key inputs for "${options.projectRoot}". Falling back to an always-miss key.`,
      error
    );
    return {
      lockfileHash: 'unavailable',
      bundlerMetroVersion: options.bundlerMetroVersion,
    };
  }
};
