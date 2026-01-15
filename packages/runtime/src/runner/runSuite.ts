import type {
  TestCase,
  TestResult,
  TestSuite,
  TestSuiteResult,
} from '@react-native-harness/bridge';
import { runHooks } from './hooks.js';
import { getTestExecutionError } from './errors.js';
import { TestRunnerContext } from './types.js';

declare global {
  var HARNESS_TEST_PATH: string;
}

const runTest = async (
  test: TestCase,
  suite: TestSuite,
  context: TestRunnerContext
): Promise<TestResult> => {
  const startTime = Date.now();

  // Emit test-started event
  context.events.emit({
    type: 'test-started',
    name: test.name,
    suite: suite.name,
    file: context.testFilePath,
  });

  try {
    if (test.status === 'skipped') {
      const result = {
        name: test.name,
        status: 'skipped' as const,
        duration: 0,
      };

      // Emit test-finished event
      context.events.emit({
        type: 'test-finished',
        name: test.name,
        suite: suite.name,
        file: context.testFilePath,
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
      };

      // Emit test-finished event
      context.events.emit({
        type: 'test-finished',
        name: test.name,
        suite: suite.name,
        file: context.testFilePath,
        duration: 0,
        status: 'todo',
      });

      return result;
    }

    // Run all beforeEach hooks from the current suite and its parents
    await runHooks(suite, 'beforeEach');

    // Run the actual test
    await test.fn();

    // Run all afterEach hooks from the current suite and its parents
    await runHooks(suite, 'afterEach');

    const duration = Date.now() - startTime;

    const result = {
      name: test.name,
      status: 'passed' as const,
      duration,
    };

    // Emit test-finished event
    context.events.emit({
      type: 'test-finished',
      file: context.testFilePath,
      suite: suite.name,
      name: test.name,
      duration,
      status: 'passed',
    });

    return result;
  } catch (error) {
    const testError = await getTestExecutionError(
      error,
      context.testFilePath,
      suite.name,
      test.name
    );
    const duration = Date.now() - startTime;

    const result = {
      name: test.name,
      status: 'failed' as const,
      error: testError.toSerializedJSON(),
      duration,
    };

    // Emit test-finished event
    context.events.emit({
      type: 'test-finished',
      file: context.testFilePath,
      suite: suite.name,
      name: test.name,
      duration,
      error: testError.toSerializedJSON(),
      status: 'failed',
    });

    return result;
  }
};

export const runSuite = async (
  suite: TestSuite,
  context: TestRunnerContext
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
    const result = {
      name: suite.name,
      tests: [],
      suites: [],
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
    const result = await runTest(test, suite, context);
    testResults.push(result);
  }

  // Run all child suites
  for (const childSuite of suite.suites) {
    const result = await runSuite(childSuite, context);
    suiteResults.push(result);
  }

  // Run afterAll hooks
  await runHooks(suite, 'afterAll');

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
