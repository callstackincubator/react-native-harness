import type { Status, TestResult } from '@jest/test-result';

export type Options = {
  stats: {
    failures: number;
    passes: number;
    pending: number;
    todo: number;
    start: number;
    end: number;
  };
  skipped: boolean;
  errorMessage?: string | null;
  tests: Array<{
    duration?: number | null;
    errorMessage?: string;
    testPath?: string;
    title?: string;
    status: Status;
  }>;
  jestTestPath: string;
  coverage?: TestResult['coverage'];
};

const getPerfStats = ({ stats }: Options): TestResult['perfStats'] => {
  const start = new Date(stats.start).getTime();
  const end = new Date(stats.end).getTime();
  const runtime = end - start;
  // Note: this flag is set in 'lib/createJestRunner.ts'
  const slow = false;
  return {
    start,
    end,
    runtime,
    slow,
    loadTestEnvironmentStart: 0,
    loadTestEnvironmentEnd: 0,
    setupAfterEnvStart: 0,
    setupAfterEnvEnd: 0,
    setupFilesStart: 0,
    setupFilesEnd: 0,
  };
};

const getSnapshot = (): TestResult['snapshot'] => {
  return {
    added: 0,
    fileDeleted: false,
    matched: 0,
    unchecked: 0,
    uncheckedKeys: [],
    unmatched: 0,
    updated: 0,
  };
};

const getTestResults = ({
  errorMessage,
  tests,
  jestTestPath,
}: Options): TestResult['testResults'] => {
  return tests.map((test) => {
    const actualErrorMessage = errorMessage || test.errorMessage;

    return {
      ancestorTitles: [],
      duration: test.duration,
      failureDetails: [],
      failureMessages: actualErrorMessage ? [actualErrorMessage] : [],
      fullName: jestTestPath || test.testPath || '',
      numPassingAsserts: test.errorMessage ? 1 : 0,
      status: test.status,
      title: test.title || '',
    };
  });
};

export const toTestResult = (options: Options): TestResult => {
  const { stats, skipped, errorMessage, jestTestPath, coverage } = options;
  return {
    failureMessage: errorMessage,
    leaks: false,
    numFailingTests: stats.failures,
    numPassingTests: stats.passes,
    numPendingTests: stats.pending,
    numTodoTests: stats.todo,
    openHandles: [],
    perfStats: getPerfStats(options),
    skipped,
    snapshot: getSnapshot(),
    testFilePath: jestTestPath,
    testResults: getTestResults(options),
    coverage,
  };
};
