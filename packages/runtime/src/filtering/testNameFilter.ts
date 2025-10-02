import { TestSuite } from '@react-native-harness/bridge';

/**
 * Filters tests by name pattern, matching against test names and suite+test combinations
 */
export const filterTestsByName = (
  suite: TestSuite, 
  testNamePattern: string
): TestSuite => {
  const regex = new RegExp(testNamePattern);
  return filterSuiteRecursively(suite, regex);
};

const filterSuiteRecursively = (suite: TestSuite, regex: RegExp): TestSuite => {
  // Filter tests in current suite - match against test name or "suite test" combination
  const filteredTests = suite.tests.filter(test => 
    regex.test(test.name) || regex.test(`${suite.name} ${test.name}`)
  );

  // Recursively filter child suites
  const filteredChildSuites = suite.suites
    .map(childSuite => filterSuiteRecursively(childSuite, regex))
    .filter(childSuite => hasAnyActiveTests(childSuite));

  return {
    ...suite,
    tests: filteredTests,
    suites: filteredChildSuites,
  };
};

const hasAnyActiveTests = (suite: TestSuite): boolean => {
  const hasDirectTests = suite.tests.some(test => test.status === 'active');
  const hasChildTests = suite.suites.some(childSuite => hasAnyActiveTests(childSuite));
  
  return hasDirectTests || hasChildTests;
};
