import type { TestCase, TestSuite } from './rntl/describe.js';
import type { TestResult, SuiteResult } from '@react-native-harness/bridge';

async function runHooks(hooks: (() => void | Promise<void>)[]): Promise<void> {
  for (const hook of hooks) {
    await hook();
  }
}

async function runTest(test: TestCase, suite: TestSuite): Promise<TestResult> {
  const startTime = Date.now();

  try {
    if (test.status === 'skipped') {
      console.log(`- ${test.name} (skipped)`);
      return {
        name: test.name,
        status: 'skipped',
        duration: 0,
      };
    }

    if (test.status === 'todo') {
      console.log(`- ${test.name} (todo)`);
      return {
        name: test.name,
        status: 'todo',
        duration: 0,
      };
    }

    // Run all beforeEach hooks from the current suite and its parents
    await runHooks(suite.beforeEach);

    // Run the actual test
    await test.fn();

    // Run all afterEach hooks from the current suite and its parents
    await runHooks(suite.afterEach);

    const duration = Date.now() - startTime;
    console.log(`✓ ${test.name}`);

    return {
      name: test.name,
      status: 'passed',
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`✗ ${test.name}`);
    console.error(error);

    return {
      name: test.name,
      status: 'failed',
      error: {
        name:
          typeof error === 'object' && error !== null && 'name' in error
            ? (error.name as string)
            : 'Unknown error',
        message:
          typeof error === 'object' && error !== null && 'message' in error
            ? (error.message as string)
            : JSON.stringify(error),
        stack:
          typeof error === 'object' && error !== null && 'stack' in error
            ? (error.stack as string)
            : undefined,
      },
      duration,
    };
  }
}

export async function runSuite(suite: TestSuite): Promise<SuiteResult> {
  console.log(`\n${suite.name}`);
  const startTime = Date.now();

  const testResults: TestResult[] = [];
  const suiteResults: SuiteResult[] = [];
  let suiteError: Error | undefined;

  try {
    // Run beforeAll hooks
    await runHooks(suite.beforeAll);

    // Run all tests in the current suite
    for (const test of suite.tests) {
      const result = await runTest(test, suite);
      testResults.push(result);
    }

    // Run all child suites
    for (const childSuite of suite.suites) {
      const result = await runSuite(childSuite);
      suiteResults.push(result);
    }

    // Run afterAll hooks
    await runHooks(suite.afterAll);
  } catch (error) {
    console.error(`Suite "${suite.name}" failed`);
    suiteError = error as Error;
  }

  const duration = Date.now() - startTime;

  // Determine overall suite status
  let status: 'passed' | 'failed' | 'skipped' | 'todo' = 'passed';

  if (suiteError) {
    status = 'failed';
  } else {
    // Check if any tests or child suites failed
    const hasFailedTests = testResults.some(
      (result) => result.status === 'failed'
    );
    const hasFailedSuites = suiteResults.some(
      (result) => result.status === 'failed'
    );

    if (hasFailedTests || hasFailedSuites) {
      status = 'failed';
    } else if (
      (testResults.every((result) => result.status === 'skipped') &&
        suiteResults.every((result) => result.status === 'skipped') &&
        testResults.length > 0) ||
      suiteResults.length > 0
    ) {
      status = 'skipped';
    }
  }

  return {
    name: suite.name,
    tests: testResults,
    suites: suiteResults,
    status,
    error: suiteError,
    duration,
  };
}
