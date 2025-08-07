import { TestError, TestErrorCode } from './errors.js';

type TestFn = () => void | Promise<void>;

export type TestStatus = 'active' | 'skipped' | 'todo';

const validateTestName = (name: string, functionName: string): void => {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new TestError(TestErrorCode.INVALID_TEST_NAME, functionName, {
      name,
    });
  }
};

const validateTestFunction = (fn: TestFn, functionName: string): void => {
  if (typeof fn !== 'function') {
    throw new TestError(TestErrorCode.INVALID_FUNCTION, functionName, {
      functionType: typeof fn,
    });
  }
};

const validateUniqueTestName = (
  suite: TestSuite,
  name: string,
  functionName: string
): void => {
  if (suite.tests.some((test) => test.name === name)) {
    throw new TestError(TestErrorCode.DUPLICATE_TEST_NAME, functionName, {
      name,
      suiteName: suite.name,
    });
  }
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
  rootSuite: TestSuite;
  currentSuite: TestSuite | null;
  hasFocusedTests: boolean;
};

let currentContext: TestContext | null = null;

const clearState = (): TestContext => {
  const rootSuite = createSuite('root');
  return {
    rootSuite,
    currentSuite: rootSuite,
    hasFocusedTests: false,
  };
};

const getCurrentSuite = (): TestSuite | null => {
  if (!currentContext) {
    throw new TestError(
      TestErrorCode.CONTEXT_NOT_INITIALIZED,
      'getCurrentSuite'
    );
  }
  return currentContext.currentSuite;
};

const getRootSuite = (): TestSuite => {
  if (!currentContext) {
    throw new TestError(TestErrorCode.CONTEXT_NOT_INITIALIZED, 'getRootSuite');
  }
  return currentContext.rootSuite;
};

const setCurrentSuite = (suite: TestSuite | null): void => {
  if (!currentContext) {
    throw new TestError(
      TestErrorCode.CONTEXT_NOT_INITIALIZED,
      'setCurrentSuite'
    );
  }
  currentContext.currentSuite = suite;
};

const getHasFocusedTests = (): boolean => {
  if (!currentContext) {
    throw new TestError(
      TestErrorCode.CONTEXT_NOT_INITIALIZED,
      'getHasFocusedTests'
    );
  }
  return currentContext.hasFocusedTests;
};

const setHasFocusedTests = (value: boolean): void => {
  if (!currentContext) {
    throw new TestError(
      TestErrorCode.CONTEXT_NOT_INITIALIZED,
      'setHasFocusedTests'
    );
  }
  currentContext.hasFocusedTests = value;
};

function createSuite(name: string, status: TestStatus = 'active'): TestSuite {
  return {
    name,
    tests: [],
    suites: [],
    beforeAll: [],
    afterAll: [],
    beforeEach: [],
    afterEach: [],
    status,
  };
}

export const describe = Object.assign(
  (name: string, fn: () => void) => {
    validateTestName(name, 'describe');
    validateTestFunction(fn, 'describe');

    const suite = createSuite(name);
    const previousSuite = getCurrentSuite();

    // Mark suites as skipped when ran after .only is called
    suite.status = getHasFocusedTests() ? 'skipped' : 'active';
    setCurrentSuite(suite);

    try {
      fn();
    } finally {
      setCurrentSuite(previousSuite);
    }

    // If this suite has focused tests/suites, propagate up to parent
    if (suite._hasFocused && previousSuite) {
      previousSuite._hasFocused = true;
      suite.status = 'active';
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

      const suite = createSuite(name, 'skipped');
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

      // Mark that we have focused tests in the test run
      setHasFocusedTests(true);

      const suite = createSuite(name, 'active');
      suite._hasFocused = true;
      const previousSuite = getCurrentSuite();

      // Mark that parent suite has a focused child and should remain active
      if (previousSuite) {
        previousSuite._hasFocused = true;

        // Only skip sibling suites if this is the first focused suite at this level
        // This allows multiple describe.only() calls to coexist
        const hasOtherFocusedSiblings = previousSuite.suites.some(
          (s) => s._hasFocused
        );
        if (!hasOtherFocusedSiblings) {
          for (const s of previousSuite.suites) {
            s.status = 'skipped';
          }
        }

        previousSuite.status = 'active';
      } else {
        // If this is at the root level, only skip existing suites if no focused suites exist
        const rootSuite = getRootSuite();
        const hasFocusedSuites = rootSuite.suites.some((s) => s._hasFocused);
        if (!hasFocusedSuites) {
          for (const s of rootSuite.suites) {
            s.status = 'skipped';
          }
        }
      }

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

function createTest(
  name: string,
  fn: TestFn,
  status: TestStatus = 'active'
): TestCase {
  return {
    name,
    fn,
    status,
  };
}

export const test = Object.assign(
  (name: string, fn: TestFn) => {
    validateTestName(name, 'test');
    validateTestFunction(fn, 'test');

    const currentSuite = getCurrentSuite();
    if (!currentSuite) {
      throw new TestError(TestErrorCode.OUTSIDE_DESCRIBE_BLOCK, 'test');
    }

    validateUniqueTestName(currentSuite, name, 'test');

    // If the suite has focused tests, regular tests should be skipped
    // This ensures only focused tests run when .only is used
    const status = currentSuite._hasFocused ? 'skipped' : 'active';
    currentSuite.tests.push(createTest(name, fn, status));
  },
  {
    skip: (name: string, fn: TestFn) => {
      validateTestName(name, 'test.skip');
      validateTestFunction(fn, 'test.skip');

      const currentSuite = getCurrentSuite();
      if (!currentSuite) {
        throw new TestError(TestErrorCode.OUTSIDE_DESCRIBE_BLOCK, 'test.skip');
      }

      validateUniqueTestName(currentSuite, name, 'test.skip');
      currentSuite.tests.push(createTest(name, fn, 'skipped'));
    },
    only: (name: string, fn: TestFn) => {
      validateTestName(name, 'test.only');
      validateTestFunction(fn, 'test.only');

      const currentSuite = getCurrentSuite();
      if (!currentSuite) {
        throw new TestError(TestErrorCode.OUTSIDE_DESCRIBE_BLOCK, 'test.only');
      }

      validateUniqueTestName(currentSuite, name, 'test.only');

      // If this is the first focused test, mark all existing non-todo tests as skipped
      if (!currentSuite._hasFocused) {
        for (const test of currentSuite.tests) {
          if (test.status !== 'todo') {
            test.status = 'skipped';
          }
        }
      }

      // Mark the suite as having focused tests
      currentSuite._hasFocused = true;

      // Add the new focused test (always active)
      const newTest = createTest(name, fn, 'active');
      currentSuite.tests.push(newTest);

      // All subsequent non-focused tests in this suite will be skipped
      // This happens automatically because of the _hasFocused flag
    },
    todo: (name: string) => {
      validateTestName(name, 'test.todo');

      const currentSuite = getCurrentSuite();
      if (!currentSuite) {
        throw new TestError(TestErrorCode.OUTSIDE_DESCRIBE_BLOCK, 'test.todo');
      }

      validateUniqueTestName(currentSuite, name, 'test.todo');
      currentSuite.tests.push(
        createTest(
          name,
          () => {
            // Empty function for todo tests
          },
          'todo'
        )
      );
    },
  }
);

export const it = test;

export function beforeAll(fn: TestFn) {
  validateTestFunction(fn, 'beforeAll');

  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new TestError(TestErrorCode.OUTSIDE_DESCRIBE_BLOCK, 'beforeAll');
  }
  currentSuite.beforeAll.push(fn);
}

export function afterAll(fn: TestFn) {
  validateTestFunction(fn, 'afterAll');

  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new TestError(TestErrorCode.OUTSIDE_DESCRIBE_BLOCK, 'afterAll');
  }
  currentSuite.afterAll.push(fn);
}

export function beforeEach(fn: TestFn) {
  validateTestFunction(fn, 'beforeEach');

  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new TestError(TestErrorCode.OUTSIDE_DESCRIBE_BLOCK, 'beforeEach');
  }
  currentSuite.beforeEach.push(fn);
}

export function afterEach(fn: TestFn) {
  validateTestFunction(fn, 'afterEach');

  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new TestError(TestErrorCode.OUTSIDE_DESCRIBE_BLOCK, 'afterEach');
  }
  currentSuite.afterEach.push(fn);
}

export const collectTests = (fn: () => void): TestSuite => {
  // Initialize context for this test collection
  currentContext = clearState();

  try {
    fn();
    return getRootSuite();
  } finally {
    // Clean up context to prevent state leakage
    currentContext = null;
  }
};
