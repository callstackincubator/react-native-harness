import type {
  HarnessTaskContext,
  TestCase,
  TestResult,
  TestSuite,
  TestSuiteResult,
} from '@react-native-harness/bridge';
import {
  setCurrentExpectTestState,
  type HarnessExpectTestState,
} from '../expect/context.js';
import { flushExpectTestState } from '../expect/errors.js';
import { runHooks } from './hooks.js';
import { getTestExecutionError } from './errors.js';
import { ActiveTestContext, TestRunnerContext } from './types.js';
import {
  runWithoutPromiseTracking,
  withPromiseTrackerTestContext,
} from '../promise-tracker.js';
import {
  createTestContext,
  createTestLifecycleState,
  isSkipTestError,
  runOnTestFailed,
  runOnTestFinished,
} from './test-context.js';

const getAncestorTitles = (suite: TestSuite): string[] => {
  const ancestorTitles: string[] = [];
  let currentSuite = suite.parent;

  while (currentSuite) {
    if (currentSuite.name !== 'root') {
      ancestorTitles.unshift(currentSuite.name);
    }
    currentSuite = currentSuite.parent;
  }

  if (suite.name !== 'root') {
    ancestorTitles.push(suite.name);
  }

  return ancestorTitles;
};

const getFullName = (ancestorTitles: string[], testName: string): string =>
  [...ancestorTitles, testName].join(' ');

const DEFAULT_TEST_TIMEOUT_MS = 5_000;

export class TestCaseTimeoutError extends Error {
  constructor(
    public readonly testName: string,
    public readonly timeout: number,
  ) {
    super(`Test timed out after ${timeout}ms: ${testName}`);
    this.name = 'TestCaseTimeoutError';
  }
}

type RunSuiteState = {
  interruptedByTimeout: boolean;
};

const getTestTimeout = (context: TestRunnerContext): number => {
  const timeout = context.testTimeout ?? DEFAULT_TEST_TIMEOUT_MS;
  return Number.isFinite(timeout) && timeout > 0
    ? timeout
    : DEFAULT_TEST_TIMEOUT_MS;
};

const withTestTimeout = async <T>(
  work: () => Promise<T>,
  options: {
    fullName: string;
    timeout: number;
  },
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = runWithoutPromiseTracking(
    () =>
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new TestCaseTimeoutError(options.fullName, options.timeout));
        }, options.timeout);
      }),
  );
  const workPromise = work();

  try {
    return await runWithoutPromiseTracking(() =>
      Promise.race([workPromise, timeoutPromise]),
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const emitTestFinished = (
  context: TestRunnerContext,
  options: {
    test: TestCase;
    suite: TestSuite;
    startedAt: number;
    duration: number;
    status: 'passed' | 'failed' | 'skipped' | 'todo';
    error?: TestResult['error'];
  }
) => {
  const ancestorTitles = getAncestorTitles(options.suite);

  context.events.emit({
    type: 'test-finished',
    file: context.testFilePath,
    suite: options.suite.name,
    name: options.test.name,
    ancestorTitles,
    fullName: getFullName(ancestorTitles, options.test.name),
    startedAt: options.startedAt,
    declarationMode: options.test.declarationMode,
    duration: options.duration,
    error: options.error,
    status: options.status,
  });
};

const createSkippedTestResult = (
  test: TestCase,
  suite: TestSuite,
  context: TestRunnerContext,
): TestResult => {
  const startedAt = Date.now();
  const ancestorTitles = getAncestorTitles(suite);
  const fullName = getFullName(ancestorTitles, test.name);
  const status: TestResult['status'] =
    test.status === 'todo' ? 'todo' : 'skipped';

  context.events.emit({
    type: 'test-started',
    name: test.name,
    suite: suite.name,
    file: context.testFilePath,
    ancestorTitles,
    fullName,
    startedAt,
    declarationMode: test.declarationMode,
  });

  const result = {
    name: test.name,
    status,
    duration: 0,
    ancestorTitles,
    fullName,
    startedAt,
    declarationMode: test.declarationMode,
  };

  emitTestFinished(context, {
    test,
    suite,
    startedAt,
    duration: 0,
    status,
  });

  return result;
};

const createSkippedSuiteResult = (
  suite: TestSuite,
  context: TestRunnerContext,
): TestSuiteResult => {
  context.events.emit({
    type: 'suite-started',
    name: suite.name,
    file: context.testFilePath,
  });

  const testResults = suite.tests.map((test) =>
    createSkippedTestResult(test, suite, context),
  );
  const suiteResults = suite.suites.map((childSuite) =>
    createSkippedSuiteResult(childSuite, context),
  );

  const result = {
    name: suite.name,
    tests: testResults,
    suites: suiteResults,
    status: 'skipped' as const,
    duration: 0,
  };

  context.events.emit({
    type: 'suite-finished',
    file: context.testFilePath,
    name: suite.name,
    duration: 0,
    status: 'skipped',
  });

  return result;
};

declare global {
  var HARNESS_TEST_PATH: string;
}

const runTest = async (
  test: TestCase,
  suite: TestSuite,
  context: TestRunnerContext,
  state: RunSuiteState
): Promise<TestResult> => {
  const startedAt = Date.now();
  const task: HarnessTaskContext = {
    name: test.name,
    type: 'test',
    mode:
      test.status === 'active'
        ? 'run'
        : test.status === 'skipped'
        ? 'skip'
        : 'todo',
    file: {
      name: context.testFilePath,
    },
    suite: {
      name: suite.name,
    },
  };
  const lifecycleState = createTestLifecycleState();
  const activeTestContext: ActiveTestContext = createTestContext(
    task,
    lifecycleState
  );

  // Emit test-started event
  const ancestorTitles = getAncestorTitles(suite);
  context.events.emit({
    type: 'test-started',
    name: test.name,
    suite: suite.name,
    file: context.testFilePath,
    ancestorTitles,
    fullName: getFullName(ancestorTitles, test.name),
    startedAt,
    declarationMode: test.declarationMode,
  });

  try {
    if (test.status === 'skipped') {
      const result = {
        name: test.name,
        status: 'skipped' as const,
        duration: 0,
        ancestorTitles,
        fullName: getFullName(ancestorTitles, test.name),
        startedAt,
        declarationMode: test.declarationMode,
      };

      emitTestFinished(context, {
        test,
        suite,
        startedAt,
        duration: 0,
        status: 'skipped',
      });

      return result;
    }

    if (test.status === 'todo') {
      console.log(`- ${test.name} (todo)`);
      const result = {
        name: test.name,
        status: 'todo' as const,
        duration: 0,
        ancestorTitles,
        fullName: getFullName(ancestorTitles, test.name),
        startedAt,
        declarationMode: test.declarationMode,
      };

      emitTestFinished(context, {
        test,
        suite,
        startedAt,
        duration: 0,
        status: 'todo',
      });

      return result;
    }

    const expectTestState: HarnessExpectTestState = {};
    setCurrentExpectTestState(expectTestState);

    try {
      const fullName = getFullName(ancestorTitles, test.name);
      let didSkip = false;

      await withTestTimeout(
        async () => {
          await withPromiseTrackerTestContext(
            {
              file: context.testFilePath,
              suite: suite.name,
              name: test.name,
              fullName,
            },
            async () => {
              try {
                // Run all beforeEach hooks from the current suite and its parents
                await runHooks(suite, 'beforeEach', activeTestContext);

                // Run the actual test
                await test.fn(activeTestContext);
              } catch (error) {
                if (!isSkipTestError(error)) {
                  throw error;
                }

                didSkip = true;
              } finally {
                // Run all afterEach hooks from the current suite and its parents
                await runHooks(suite, 'afterEach', activeTestContext);
              }
            }
          );

          if (!didSkip) {
            await flushExpectTestState(expectTestState);
            await runOnTestFinished(lifecycleState);
          }
        },
        {
          fullName,
          timeout: getTestTimeout(context),
        },
      );

      if (didSkip) {
        const duration = Date.now() - startedAt;

        await runOnTestFinished(lifecycleState);

        const result = {
          name: test.name,
          status: 'skipped' as const,
          duration,
          ancestorTitles,
          fullName: getFullName(ancestorTitles, test.name),
          startedAt,
          declarationMode: test.declarationMode,
        };

        emitTestFinished(context, {
          test,
          suite,
          startedAt,
          duration,
          status: 'skipped',
        });

        return result;
      }

    } finally {
      setCurrentExpectTestState(undefined);
    }

    const duration = Date.now() - startedAt;

    const result = {
      name: test.name,
      status: 'passed' as const,
      duration,
      ancestorTitles,
      fullName: getFullName(ancestorTitles, test.name),
      startedAt,
      declarationMode: test.declarationMode,
    };

    emitTestFinished(context, {
      test,
      suite,
      startedAt,
      duration,
      status: 'passed',
    });

    return result;
  } catch (error) {
    if (error instanceof TestCaseTimeoutError) {
      state.interruptedByTimeout = true;
    }

    await runOnTestFailed(lifecycleState);
    await runOnTestFinished(lifecycleState);

    const testError = await getTestExecutionError(
      error,
      context.testFilePath,
      suite.name,
      test.name
    );
    const duration = Date.now() - startedAt;

    const result = {
      name: test.name,
      status: 'failed' as const,
      error: testError.toSerializedJSON(),
      duration,
      ancestorTitles,
      fullName: getFullName(ancestorTitles, test.name),
      startedAt,
      declarationMode: test.declarationMode,
    };

    emitTestFinished(context, {
      test,
      suite,
      startedAt,
      duration,
      error: testError.toSerializedJSON(),
      status: 'failed',
    });

    return result;
  }
};

export const runSuite = async (
  suite: TestSuite,
  context: TestRunnerContext,
  state: RunSuiteState = { interruptedByTimeout: false }
): Promise<TestSuiteResult> => {
  const startTime = Date.now();

  // Emit suite-started event
  context.events.emit({
    type: 'suite-started',
    name: suite.name,
    file: context.testFilePath,
  });

  // Check if suite should be skipped or is todo
  if (suite.status === 'skipped') {
    const testResults = await Promise.all(
      suite.tests.map((test) =>
        runTest({ ...test, status: 'skipped' }, suite, context, state)
      )
    );
    const suiteResults = await Promise.all(
      suite.suites.map((childSuite) =>
        runSuite({ ...childSuite, status: 'skipped' }, context, state)
      )
    );

    const result = {
      name: suite.name,
      tests: testResults,
      suites: suiteResults,
      status: 'skipped' as const,
      duration: 0,
    };

    // Emit suite-finished event
    context.events.emit({
      type: 'suite-finished',
      file: context.testFilePath,
      name: suite.name,
      duration: 0,
      status: 'skipped',
    });

    return result;
  }

  if (suite.status === 'todo') {
    const result = {
      name: suite.name,
      tests: [],
      suites: [],
      status: 'todo' as const,
      duration: 0,
    };

    // Emit suite-finished event
    context.events.emit({
      type: 'suite-finished',
      file: context.testFilePath,
      name: suite.name,
      duration: 0,
      status: 'todo',
    });

    return result;
  }

  const testResults: TestResult[] = [];
  const suiteResults: TestSuiteResult[] = [];

  // Run beforeAll hooks
  await runHooks(suite, 'beforeAll');

  // Run all tests in the current suite
  for (const test of suite.tests) {
    const result = state.interruptedByTimeout
      ? createSkippedTestResult(test, suite, context)
      : await runTest(test, suite, context, state);
    testResults.push(result);
  }

  // Run all child suites
  for (const childSuite of suite.suites) {
    const result = state.interruptedByTimeout
      ? createSkippedSuiteResult(childSuite, context)
      : await runSuite(childSuite, context, state);
    suiteResults.push(result);
  }

  // Run afterAll hooks
  if (!state.interruptedByTimeout) {
    await runHooks(suite, 'afterAll');
  }

  const duration = Date.now() - startTime;

  // Determine overall suite status
  let status: 'passed' | 'failed' | 'skipped' | 'todo' = 'passed';

  // Check if any tests or child suites failed
  const hasFailedTests = testResults.some(
    (result) => result.status === 'failed'
  );
  const hasFailedSuites = suiteResults.some(
    (result) => result.status === 'failed'
  );

  if (hasFailedTests || hasFailedSuites) {
    status = 'failed';
  } else {
    // Check if all tests and suites are skipped (and there are some tests/suites to check)
    const allTestsSkipped =
      testResults.length > 0 &&
      testResults.every((result) => result.status === 'skipped');
    const allSuitesSkipped =
      suiteResults.length > 0 &&
      suiteResults.every((result) => result.status === 'skipped');
    const hasAnyContent = testResults.length > 0 || suiteResults.length > 0;

    if (
      hasAnyContent &&
      ((testResults.length > 0 &&
        allTestsSkipped &&
        suiteResults.length === 0) ||
        (suiteResults.length > 0 &&
          allSuitesSkipped &&
          testResults.length === 0) ||
        (testResults.length > 0 &&
          suiteResults.length > 0 &&
          allTestsSkipped &&
          allSuitesSkipped))
    ) {
      status = 'skipped';
    }
  }

  // Emit suite-finished event
  context.events.emit({
    type: 'suite-finished',
    file: context.testFilePath,
    name: suite.name,
    duration,
    status,
  });

  return {
    name: suite.name,
    tests: testResults,
    suites: suiteResults,
    status,
    duration,
  };
};
