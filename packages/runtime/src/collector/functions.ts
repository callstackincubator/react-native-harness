import { TestError } from './errors.js';
import { TestFn } from './types.js';
import { validateTestName, validateTestFunction } from './validation.js';

export type TestStatus = 'active' | 'skipped' | 'todo';

type RawTestCase = {
  name: string;
  fn: TestFn;
  options: {
    only?: boolean;
    skip?: boolean;
    todo?: boolean;
  };
};

type RawTestSuite = {
  name: string;
  tests: RawTestCase[];
  suites: RawTestSuite[];
  hooks: {
    beforeAll: TestFn[];
    afterAll: TestFn[];
    beforeEach: TestFn[];
    afterEach: TestFn[];
  };
  options: {
    only?: boolean;
    skip?: boolean;
  };
};

// Computation functions for two-phase approach
const computeTestStatus = (
  test: RawTestCase,
  suiteContext: { hasFocusedTests: boolean }
): TestStatus => {
  if (test.options.todo) return 'todo';
  if (test.options.skip) return 'skipped';
  if (test.options.only) return 'active';
  if (suiteContext.hasFocusedTests) return 'skipped';
  return 'active';
};

const computeSuiteStatus = (
  suite: RawTestSuite,
  parentContext: { hasFocusedChildren: boolean }
): TestStatus => {
  if (suite.options.skip) return 'skipped';
  if (suite.options.only) return 'active';
  if (parentContext.hasFocusedChildren) return 'skipped';
  return 'active';
};

const convertRawTestCaseToTestCase = (
  rawTest: RawTestCase,
  suiteContext: { hasFocusedTests: boolean }
): TestCase => {
  return {
    name: rawTest.name,
    fn: rawTest.fn,
    status: computeTestStatus(rawTest, suiteContext),
  };
};

const convertRawTestSuiteToTestSuite = (
  rawSuite: RawTestSuite,
  parentContext: { hasFocusedChildren: boolean } = { hasFocusedChildren: false }
): TestSuite => {
  // Validate duplicate test names within this suite
  const testNames = new Set<string>();
  for (const test of rawSuite.tests) {
    if (testNames.has(test.name)) {
      throw new TestError('DUPLICATE_TEST_NAME', 'test', {
        name: test.name,
        suiteName: rawSuite.name,
      });
    }
    testNames.add(test.name);
  }

  // Check if this suite has focused tests
  const hasFocusedTests = rawSuite.tests.some((test) => test.options.only);

  // Check if this suite has focused children
  const hasFocusedChildren = rawSuite.suites.some(
    (suite) =>
      suite.options.only || suite.tests.some((test) => test.options.only)
  );

  // Convert tests
  const tests = rawSuite.tests.map((test) =>
    convertRawTestCaseToTestCase(test, { hasFocusedTests })
  );

  // Convert child suites
  const suites = rawSuite.suites.map((suite) =>
    convertRawTestSuiteToTestSuite(suite, { hasFocusedChildren })
  );

  return {
    name: rawSuite.name,
    tests,
    suites,
    beforeAll: rawSuite.hooks.beforeAll,
    afterAll: rawSuite.hooks.afterAll,
    beforeEach: rawSuite.hooks.beforeEach,
    afterEach: rawSuite.hooks.afterEach,
    status: computeSuiteStatus(rawSuite, parentContext),
    _hasFocused: hasFocusedTests || hasFocusedChildren || rawSuite.options.only,
  };
};

export type TestCase = {
  name: string;
  fn: TestFn;
  status: TestStatus;
};

export type TestSuite = {
  name: string;
  tests: TestCase[];
  suites: TestSuite[];
  beforeAll: TestFn[];
  afterAll: TestFn[];
  beforeEach: TestFn[];
  afterEach: TestFn[];
  status?: TestStatus;
  _hasFocused?: boolean;
};

type TestContext = {
  rootSuite: RawTestSuite;
  currentSuite: RawTestSuite | null;
};

let currentContext: TestContext | null = null;

const clearState = (): TestContext => {
  const rootSuite = createRawSuite('root');
  return {
    rootSuite,
    currentSuite: rootSuite,
  };
};

const getCurrentSuite = (): RawTestSuite | null => {
  if (!currentContext) {
    throw new TestError('CONTEXT_NOT_INITIALIZED', 'getCurrentSuite');
  }
  return currentContext.currentSuite;
};

const getRootSuite = (): RawTestSuite => {
  if (!currentContext) {
    throw new TestError('CONTEXT_NOT_INITIALIZED', 'getRootSuite');
  }
  return currentContext.rootSuite;
};

const setCurrentSuite = (suite: RawTestSuite | null): void => {
  if (!currentContext) {
    throw new TestError('CONTEXT_NOT_INITIALIZED', 'setCurrentSuite');
  }
  currentContext.currentSuite = suite;
};

const createRawSuite = (
  name: string,
  options: { only?: boolean; skip?: boolean } = {}
): RawTestSuite => {
  return {
    name,
    tests: [],
    suites: [],
    hooks: {
      beforeAll: [],
      afterAll: [],
      beforeEach: [],
      afterEach: [],
    },
    options,
  };
};

export const describe = Object.assign(
  (name: string, fn: () => void) => {
    validateTestName(name, 'describe');
    validateTestFunction(fn, 'describe');

    const suite = createRawSuite(name);
    const previousSuite = getCurrentSuite();
    setCurrentSuite(suite);

    try {
      fn();
    } finally {
      setCurrentSuite(previousSuite);
    }

    // Add the suite to its parent
    if (previousSuite) {
      previousSuite.suites.push(suite);
    } else {
      getRootSuite().suites.push(suite);
    }
  },
  {
    skip: (name: string, fn: () => void) => {
      validateTestName(name, 'describe.skip');
      validateTestFunction(fn, 'describe.skip');

      const suite = createRawSuite(name, { skip: true });
      const previousSuite = getCurrentSuite();
      setCurrentSuite(suite);

      try {
        fn();
      } finally {
        setCurrentSuite(previousSuite);
      }

      // Add the suite to its parent
      if (previousSuite) {
        previousSuite.suites.push(suite);
      } else {
        getRootSuite().suites.push(suite);
      }
    },
    only: (name: string, fn: () => void) => {
      validateTestName(name, 'describe.only');
      validateTestFunction(fn, 'describe.only');

      const suite = createRawSuite(name, { only: true });
      const previousSuite = getCurrentSuite();
      setCurrentSuite(suite);

      try {
        fn();
      } finally {
        setCurrentSuite(previousSuite);
      }

      // Add the suite to its parent
      if (previousSuite) {
        previousSuite.suites.push(suite);
      } else {
        getRootSuite().suites.push(suite);
      }
    },
  }
);

export const test = Object.assign(
  (name: string, fn: TestFn) => {
    validateTestName(name, 'test');
    validateTestFunction(fn, 'test');

    const currentSuite = getCurrentSuite();
    if (!currentSuite) {
      throw new TestError('OUTSIDE_DESCRIBE_BLOCK', 'test');
    }

    // Add test with default options
    currentSuite.tests.push({ name, fn, options: {} });
  },
  {
    skip: (name: string, fn: TestFn) => {
      validateTestName(name, 'test.skip');
      validateTestFunction(fn, 'test.skip');

      const currentSuite = getCurrentSuite();
      if (!currentSuite) {
        throw new TestError('OUTSIDE_DESCRIBE_BLOCK', 'test.skip');
      }

      currentSuite.tests.push({ name, fn, options: { skip: true } });
    },
    only: (name: string, fn: TestFn) => {
      validateTestName(name, 'test.only');
      validateTestFunction(fn, 'test.only');

      const currentSuite = getCurrentSuite();
      if (!currentSuite) {
        throw new TestError('OUTSIDE_DESCRIBE_BLOCK', 'test.only');
      }

      currentSuite.tests.push({ name, fn, options: { only: true } });
    },
    todo: (name: string) => {
      validateTestName(name, 'test.todo');

      const currentSuite = getCurrentSuite();
      if (!currentSuite) {
        throw new TestError('OUTSIDE_DESCRIBE_BLOCK', 'test.todo');
      }

      currentSuite.tests.push({
        name,
        fn: () => {
          // Empty function for todo tests
        },
        options: { todo: true },
      });
    },
  }
);

export const it = test;

export function beforeAll(fn: TestFn) {
  validateTestFunction(fn, 'beforeAll');

  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new TestError('OUTSIDE_DESCRIBE_BLOCK', 'beforeAll');
  }
  currentSuite.hooks.beforeAll.push(fn);
}

export function afterAll(fn: TestFn) {
  validateTestFunction(fn, 'afterAll');

  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new TestError('OUTSIDE_DESCRIBE_BLOCK', 'afterAll');
  }
  currentSuite.hooks.afterAll.push(fn);
}

export function beforeEach(fn: TestFn) {
  validateTestFunction(fn, 'beforeEach');

  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new TestError('OUTSIDE_DESCRIBE_BLOCK', 'beforeEach');
  }
  currentSuite.hooks.beforeEach.push(fn);
}

export function afterEach(fn: TestFn) {
  validateTestFunction(fn, 'afterEach');

  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new TestError('OUTSIDE_DESCRIBE_BLOCK', 'afterEach');
  }
  currentSuite.hooks.afterEach.push(fn);
}

export const collectTests = (fn: () => void): TestSuite => {
  currentContext = clearState();

  try {
    fn();

    // Convert raw structure to final structure using computation phase
    return convertRawTestSuiteToTestSuite(getRootSuite());
  } finally {
    currentContext = null;
  }
};
