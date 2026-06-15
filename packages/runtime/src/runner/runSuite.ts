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
import { runHooks, type HookType } from './hooks.js';
import { getTestExecutionError } from './errors.js';
import { ActiveTestContext, TestRunnerContext } from './types.js';
import {
  getPendingPromises,
  omitPromiseFromTracking,
  runWithoutPromiseTracking,
  type TrackedPromiseRecord,
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
const MAX_PENDING_PROMISE_DIAGNOSTICS = 10;

type PendingPromiseDiagnostics = {
  total: number;
  items: Array<{
    id: number;
    createdAt: number;
    stack?: string;
  }>;
};

const getPendingPromiseDiagnostics = (
  promises: TrackedPromiseRecord[],
): PendingPromiseDiagnostics => ({
  total: promises.length,
  items: promises
    .slice(0, MAX_PENDING_PROMISE_DIAGNOSTICS)
    .map(({ id, createdAt, stack }) => ({ id, createdAt, stack })),
});

export class TestCaseTimeoutError extends Error {
  diagnostics?: {
    pendingPromises?: PendingPromiseDiagnostics;
  };

  constructor(
    public readonly testName: string,
    public readonly timeout: number,
    diagnostics?: TestCaseTimeoutError['diagnostics'],
  ) {
    super(`Test timed out after ${timeout}ms: ${testName}`);
    this.name = 'TestCaseTimeoutError';
    this.diagnostics = diagnostics;
  }
}

export class SuiteHookTimeoutError extends Error {
  diagnostics?: {
    pendingPromises?: PendingPromiseDiagnostics;
  };

  constructor(
    public readonly hookType: Extract<HookType, 'beforeAll' | 'afterAll'>,
    public readonly suiteName: string,
    public readonly timeout: number,
    diagnostics?: SuiteHookTimeoutError['diagnostics'],
  ) {
    super(`${hookType} hook timed out after ${timeout}ms in suite: ${suiteName}`);
    this.name = 'SuiteHookTimeoutError';
    this.diagnostics = diagnostics;
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

const withRuntimeTimeout = async <T>(
  work: () => Promise<T>,
  options: {
    createTimeoutError: () => Error;
    timeout: number;
  },
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = runWithoutPromiseTracking(
    () =>
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(options.createTimeoutError());
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

const withTestTimeout = async <T>(
  work: () => Promise<T>,
  options: {
    file: string;
    fullName: string;
    timeout: number;
  },
): Promise<T> => {
  const getMatchingPendingPromises = () =>
    getPendingPromises().filter(
      (promise) =>
        promise.test?.file === options.file &&
        promise.test.fullName === options.fullName &&
        (promise.test.phase === 'beforeEach' ||
          promise.test.phase === 'test' ||
          promise.test.phase === 'afterEach'),
    );

  return await withRuntimeTimeout(work, {
    timeout: options.timeout,
    createTimeoutError: () =>
      new TestCaseTimeoutError(options.fullName, options.timeout, {
        pendingPromises: getPendingPromiseDiagnostics(
          getMatchingPendingPromises(),
        ),
      }),
  });
};

const withSuiteHookTimeout = async (
  work: () => Promise<void>,
  options: {
    file: string;
    hookType: Extract<HookType, 'beforeAll' | 'afterAll'>;
    suiteName: string;
    timeout: number;
  },
): Promise<void> => {
  const getMatchingPendingPromises = () =>
    getPendingPromises().filter(
      (promise) =>
        promise.test?.file === options.file &&
        promise.test.suite === options.suiteName &&
        promise.test.phase === options.hookType,
    );

  return await withRuntimeTimeout(
    work,
    {
      timeout: options.timeout,
      createTimeoutError: () =>
        new SuiteHookTimeoutError(
          options.hookType,
          options.suiteName,
          options.timeout,
          {
            pendingPromises: getPendingPromiseDiagnostics(
              getMatchingPendingPromises(),
            ),
          },
        ),
    },
  );
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
  let timedOut = false;
  let onTestFinishedRan = false;

  const runTestFinishedOnce = async (): Promise<void> => {
    if (onTestFinishedRan) {
      return;
    }

    onTestFinishedRan = true;
    await runOnTestFinished(lifecycleState);
  };

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
          try {
            // Run all beforeEach hooks from the current suite and its parents
            await runHooks(suite, 'beforeEach', activeTestContext, {
              wrapHook: (runHook) =>
                withPromiseTrackerTestContext(
                  {
                    file: context.testFilePath,
                    suite: suite.name,
                    name: test.name,
                    fullName,
                    phase: 'beforeEach',
                  },
                  runHook,
                  { omitReturnedPromise: true },
                ),
            });

            // Run the actual test
            await withPromiseTrackerTestContext(
              {
                file: context.testFilePath,
                suite: suite.name,
                name: test.name,
                fullName,
                phase: 'test',
              },
              async () => {
                const result = test.fn(activeTestContext);
                omitPromiseFromTracking(result);
                await result;
              },
              { omitReturnedPromise: true },
            );
          } catch (error) {
            if (!isSkipTestError(error)) {
              throw error;
            }

            didSkip = true;
          } finally {
            // Run all afterEach hooks from the current suite and its parents
            if (!timedOut) {
              await runHooks(suite, 'afterEach', activeTestContext, {
                wrapHook: (runHook) =>
                  withPromiseTrackerTestContext(
                    {
                      file: context.testFilePath,
                      suite: suite.name,
                      name: test.name,
                      fullName,
                      phase: 'afterEach',
                    },
                    runHook,
                    { omitReturnedPromise: true },
                  ),
              });
            }
          }

          if (!didSkip && !timedOut) {
            await flushExpectTestState(expectTestState);
            await runTestFinishedOnce();
          }
        },
        {
          file: context.testFilePath,
          fullName,
          timeout: getTestTimeout(context),
        },
      );

      if (didSkip) {
        const duration = Date.now() - startedAt;

        await runTestFinishedOnce();

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
      timedOut = true;
    }

    await runOnTestFailed(lifecycleState);
    await runTestFinishedOnce();

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
  try {
    await withSuiteHookTimeout(
      () =>
        runHooks(suite, 'beforeAll', undefined, {
          wrapHook: (runHook) =>
            withPromiseTrackerTestContext(
              {
                file: context.testFilePath,
                suite: suite.name,
                name: 'beforeAll',
                fullName: `${suite.name} beforeAll`,
                phase: 'beforeAll',
              },
              runHook,
              { omitReturnedPromise: true },
            ),
        }),
      {
        file: context.testFilePath,
        hookType: 'beforeAll',
        suiteName: suite.name,
        timeout: getTestTimeout(context),
      },
    );
  } catch (error) {
    if (!(error instanceof SuiteHookTimeoutError)) {
      throw error;
    }

    state.interruptedByTimeout = true;
    const duration = Date.now() - startTime;
    const suiteError = (
      await getTestExecutionError(
        error,
        context.testFilePath,
        suite.name,
        'beforeAll',
      )
    ).toSerializedJSON();
    const skippedTests = suite.tests.map((test) =>
      createSkippedTestResult(test, suite, context),
    );
    const skippedSuites = suite.suites.map((childSuite) =>
      createSkippedSuiteResult(childSuite, context),
    );

    context.events.emit({
      type: 'suite-finished',
      file: context.testFilePath,
      name: suite.name,
      duration,
      error: suiteError,
      status: 'failed',
    });

    return {
      name: suite.name,
      tests: skippedTests,
      suites: skippedSuites,
      status: 'failed',
      error: suiteError,
      duration,
    };
  }

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
  let suiteError: TestSuiteResult['error'];
  if (!state.interruptedByTimeout) {
    try {
      await withSuiteHookTimeout(
        () =>
          runHooks(suite, 'afterAll', undefined, {
            wrapHook: (runHook) =>
              withPromiseTrackerTestContext(
                {
                  file: context.testFilePath,
                  suite: suite.name,
                  name: 'afterAll',
                  fullName: `${suite.name} afterAll`,
                  phase: 'afterAll',
                },
                runHook,
                { omitReturnedPromise: true },
              ),
          }),
        {
          file: context.testFilePath,
          hookType: 'afterAll',
          suiteName: suite.name,
          timeout: getTestTimeout(context),
        },
      );
    } catch (error) {
      if (!(error instanceof SuiteHookTimeoutError)) {
        throw error;
      }

      state.interruptedByTimeout = true;
      suiteError = (
        await getTestExecutionError(
          error,
          context.testFilePath,
          suite.name,
          'afterAll',
        )
      ).toSerializedJSON();
    }
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

  if (suiteError || hasFailedTests || hasFailedSuites) {
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
    error: suiteError,
    status,
  });

  return {
    name: suite.name,
    tests: testResults,
    suites: suiteResults,
    status,
    error: suiteError,
    duration,
  };
};
