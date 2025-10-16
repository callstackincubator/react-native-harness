import { TestSuite } from '@react-native-harness/bridge';

/**
 * Filters tests by name pattern, matching against test names and suite+test combinations
 * @deprecated Use markTestsAsSkippedByName instead - this function will be removed in a future version
 */
export const filterTestsByName = (
  suite: TestSuite,
  testNamePattern: string
): TestSuite => {
  const regex = new RegExp(testNamePattern);
  return filterSuiteRecursively(suite, regex);
};

/**
 * Marks tests as skipped based on name pattern, keeping all tests in the structure
 * but setting non-matching tests to 'skipped' status
 */
export const markTestsAsSkippedByName = (
  suite: TestSuite,
  testNamePattern: string
): TestSuite => {
  const regex = new RegExp(testNamePattern);
  return markTestsRecursively(suite, regex);
};

const markTestsRecursively = (suite: TestSuite, regex: RegExp): TestSuite => {
  // Mark tests in current suite - skip tests that don't match the pattern
  const updatedTests = suite.tests.map((test) => {
    const matches =
      regex.test(test.name) || regex.test(`${suite.name} ${test.name}`);

    // If test doesn't match pattern and is currently active, mark it as skipped
    if (!matches && test.status === 'active') {
      return {
        ...test,
        status: 'skipped' as const,
      };
    }

    // Keep original status for matching tests or already skipped/todo tests
    return test;
  });

  // Recursively process child suites
  const updatedChildSuites = suite.suites.map((childSuite) =>
    markTestsRecursively(childSuite, regex)
  );

  return {
    ...suite,
    tests: updatedTests,
    suites: updatedChildSuites,
  };
};

const filterSuiteRecursively = (suite: TestSuite, regex: RegExp): TestSuite => {
  // Filter tests in current suite - match against test name or "suite test" combination
  const filteredTests = suite.tests.filter(
    (test) => regex.test(test.name) || regex.test(`${suite.name} ${test.name}`)
  );

  // Recursively filter child suites
  const filteredChildSuites = suite.suites
    .map((childSuite) => filterSuiteRecursively(childSuite, regex))
    .filter((childSuite) => hasAnyActiveTests(childSuite));

  return {
    ...suite,
    tests: filteredTests,
    suites: filteredChildSuites,
  };
};

const hasAnyActiveTests = (suite: TestSuite): boolean => {
  const hasDirectTests = suite.tests.some((test) => test.status === 'active');
  const hasChildTests = suite.suites.some((childSuite) =>
    hasAnyActiveTests(childSuite)
  );

  return hasDirectTests || hasChildTests;
};
