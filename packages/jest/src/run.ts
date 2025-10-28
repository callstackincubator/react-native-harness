import path from 'node:path';
import type { Config as JestConfig } from 'jest-runner';
import { TestResult as JestTestResult } from '@jest/test-result';
import type {
  TestSuiteResult as HarnessTestSuiteResult,
  TestResult as HarnessTestResult,
} from '@react-native-harness/bridge';
import type { Harness } from './harness.js';
import { formatResultsErrors } from 'jest-message-util';
import { toTestResult } from './toTestResult.js';

// Helper function to flatten nested test suites into a flat array of tests with hierarchy
const flattenTests = (
  suiteResult: HarnessTestSuiteResult,
  ancestorTitles: string[] = []
): Array<HarnessTestResult & { ancestorTitles: string[] }> => {
  const tests: Array<HarnessTestResult & { ancestorTitles: string[] }> = [];

  // Add tests from current suite with current hierarchy
  for (const test of suiteResult.tests) {
    tests.push({
      ...test,
      ancestorTitles: [...ancestorTitles],
    });
  }

  // Process child suites with updated hierarchy
  for (const childSuite of suiteResult.suites) {
    const newAncestorTitles = [...ancestorTitles, childSuite.name];
    tests.push(...flattenTests(childSuite, newAncestorTitles));
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

  const results = await harness.runTests(relativeTestPath, {
    testNamePattern: globalConfig.testNamePattern,
    setupFiles,
    setupFilesAfterEnv,
  });
  const end = Date.now();

  const allTests = flattenTests(results);
  const stats = calculateStats(allTests);

  // Convert TestResult[] to the format expected by toTestResult
  const tests = allTests.map((test) => {
    const errorMessage = test.error?.message;
    const codeFrame = test.error?.codeFrame;

    return {
      duration: test.duration,
      errorMessage: errorMessage
        ? `${errorMessage}${codeFrame ? `\n\n${codeFrame.content}` : ''}`
        : undefined,
      title: test.name,
      status: test.status,
      location: codeFrame?.location
        ? { column: codeFrame.location.column, line: codeFrame.location.row }
        : undefined,
      ancestorTitles: test.ancestorTitles,
    };
  });

  // Check if the entire suite was skipped
  const skipped = results.status === 'skipped';

  // Get error message from suite if it failed
  const errorMessage = results.error?.message || null;

  const totalResults = toTestResult({
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
    coverage: results.coverage as JestTestResult['coverage'],
  });

  totalResults.failureMessage = formatResultsErrors(
    totalResults.testResults,
    projectConfig,
    globalConfig,
    testPath
  );

  return totalResults;
};
