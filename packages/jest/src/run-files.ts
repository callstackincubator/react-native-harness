import type { Test } from 'jest-runner';
import { toRelativePosixPath } from './relative-path.js';
import { shouldRunHarnessTestFile } from './test-file-platform-filter.js';

/**
 * The files a run asks the app to load, as the app receives them: the test
 * files that run on this platform and the setup files of their projects.
 */
export const collectRunFiles = ({
  tests,
  rootDir,
  platformId,
  knownPlatformIds,
}: {
  tests: Array<Test>;
  rootDir: string;
  platformId: string;
  knownPlatformIds: ReadonlySet<string>;
}): string[] => {
  const files = new Set<string>();

  for (const test of tests) {
    if (!shouldRunHarnessTestFile(test.path, platformId, knownPlatformIds)) {
      continue;
    }

    const { setupFiles = [], setupFilesAfterEnv = [] } = test.context.config;

    for (const file of [test.path, ...setupFiles, ...setupFilesAfterEnv]) {
      files.add(toRelativePosixPath(rootDir, file));
    }
  }

  return [...files];
};
