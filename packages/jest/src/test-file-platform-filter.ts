import path from 'node:path';
import type { TestResult as JestTestResult } from '@jest/test-result';
import { toTestResult } from './toTestResult.js';

const PLATFORM_SPECIFIC_HARNESS_FILE =
  /\.([^.]+)\.harness\.(?:[mc]?[jt]sx?)$/;

export const getHarnessTestFilePlatform = (
  testPath: string,
  knownPlatformIds: ReadonlySet<string>,
): string | null => {
  const match = path.basename(testPath).match(PLATFORM_SPECIFIC_HARNESS_FILE);
  if (!match) {
    return null;
  }

  const candidate = match[1];
  return knownPlatformIds.has(candidate) ? candidate : null;
};

export const shouldRunHarnessTestFile = (
  testPath: string,
  platformId: string,
  knownPlatformIds: ReadonlySet<string>,
): boolean => {
  const filePlatform = getHarnessTestFilePlatform(testPath, knownPlatformIds);
  return filePlatform == null || filePlatform === platformId;
};

export const createPlatformSkippedTestResult = (
  testPath: string,
): JestTestResult => {
  const now = Date.now();
  const title = path.basename(testPath);

  return toTestResult({
    stats: {
      failures: 0,
      passes: 0,
      pending: 1,
      todo: 0,
      start: now,
      end: now,
    },
    skipped: true,
    errorMessage: null,
    tests: [
      {
        status: 'skipped',
        title,
        fullName: title,
        testPath,
      },
    ],
    jestTestPath: testPath,
  });
};
