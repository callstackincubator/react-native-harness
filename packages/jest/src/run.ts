import path from 'node:path';
import type { Config as JestConfig } from 'jest-runner';
import { TestResult as JestTestResult } from '@jest/test-result';
import type {
  TestSuiteResult as HarnessTestSuiteResult,
  TestResult as HarnessTestResult,
} from '@react-native-harness/bridge';
import type { Harness } from '@react-native-harness/cli/external';

import { toTestResult } from './toTestResult.js';

// Helper function to flatten nested test suites into a flat array of tests
const flattenTests = (
  suiteResult: HarnessTestSuiteResult
): HarnessTestResult[] => {
  const tests: HarnessTestResult[] = [...suiteResult.tests];

  for (const childSuite of suiteResult.suites) {
    tests.push(...flattenTests(childSuite));
  }

  return tests;
};

// Helper function to calculate test statistics
const calculateStats = (tests: HarnessTestResult[]) => {
  let passes = 0;
  let failures = 0;
  let pending = 0;
  let todo = 0;

  for (const test of tests) {
    switch (test.status) {
      case 'passed':
        passes++;
        break;
      case 'failed':
        failures++;
        break;
      case 'skipped':
        pending++;
        break;
      case 'todo':
        todo++;
        break;
    }
  }

  return { passes, failures, pending, todo };
};

export type RunHarnessTestFile = (options: {
  testPath: string;
  harness: Harness;
  projectConfig: JestConfig.ProjectConfig;
  globalConfig: JestConfig.GlobalConfig;
}) => Promise<JestTestResult>;

export const runHarnessTestFile: RunHarnessTestFile = async ({
  testPath,
  globalConfig,
  projectConfig,
  harness,
}) => {
  const start = Date.now();
  const relativeTestPath = path.relative(globalConfig.rootDir, testPath);

  // Extract setup files from Jest config and convert to relative paths
  const setupFiles = projectConfig.setupFiles?.map((setupFile) =>
    path.relative(globalConfig.rootDir, setupFile)
  );
  const setupFilesAfterEnv = projectConfig.setupFilesAfterEnv?.map(
    (setupFile) => path.relative(globalConfig.rootDir, setupFile)
  );

  const client = harness.bridge.rpc.clients.at(-1)!;
  const results = await client.runTests(relativeTestPath, {
    testNamePattern: globalConfig.testNamePattern,
    setupFiles,
    setupFilesAfterEnv,
  });
  const end = Date.now();

  const allTests = flattenTests(results);
  const stats = calculateStats(allTests);

  // Convert TestResult[] to the format expected by toTestResult
  const tests = allTests.map((test) => ({
    duration: test.duration,
    errorMessage: test.error?.message,
    title: test.name,
    status: test.status,
  }));

  // Check if the entire suite was skipped
  const skipped = results.status === 'skipped';

  // Get error message from suite if it failed
  const errorMessage = results.error?.message || null;

  return toTestResult({
    stats: {
      failures: stats.failures,
      pending: stats.pending,
      passes: stats.passes,
      todo: stats.todo,
      start,
      end,
    },
    skipped,
    errorMessage,
    tests,
    jestTestPath: testPath,
  });
};
