type TestFn = () => void | Promise<void>;

export type TestStatus = 'active' | 'skipped' | 'todo';

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
    throw new Error('Test context not initialized. Call collectTests() first.');
  }
  return currentContext.currentSuite;
};

const getRootSuite = (): TestSuite => {
  if (!currentContext) {
    throw new Error('Test context not initialized. Call collectTests() first.');
  }
  return currentContext.rootSuite;
};

const setCurrentSuite = (suite: TestSuite | null): void => {
  if (!currentContext) {
    throw new Error('Test context not initialized. Call collectTests() first.');
  }
  currentContext.currentSuite = suite;
};

const getHasFocusedTests = (): boolean => {
  if (!currentContext) {
    throw new Error('Test context not initialized. Call collectTests() first.');
  }
  return currentContext.hasFocusedTests;
};

const setHasFocusedTests = (value: boolean): void => {
  if (!currentContext) {
    throw new Error('Test context not initialized. Call collectTests() first.');
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
      // Mark that we have focused tests in the test run
      setHasFocusedTests(true);

      const suite = createSuite(name, 'active');
      suite._hasFocused = true;
      const previousSuite = getCurrentSuite();

      // Mark that parent suite has a focused child and should remain active
      if (previousSuite) {
        previousSuite._hasFocused = true;

        // Skip sibling suites
        for (const s of previousSuite.suites) {
          s.status = 'skipped';
        }

        previousSuite.status = 'active';
      } else {
        // If this is at the root level, mark all existing suites as skipped
        const rootSuite = getRootSuite();
        for (const s of rootSuite.suites) {
          s.status = 'skipped';
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
    const currentSuite = getCurrentSuite();
    if (!currentSuite) {
      throw new Error('test() must be called within a describe() block');
    }

    // If running tests directly, don't apply the hasFocusedTests check
    // Tests only get skipped by `.only` in the same test suite
    const status = currentSuite._hasFocused ? 'skipped' : 'active';
    currentSuite.tests.push(createTest(name, fn, status));
  },
  {
    skip: (name: string, fn: TestFn) => {
      const currentSuite = getCurrentSuite();
      if (!currentSuite) {
        throw new Error('test.skip() must be called within a describe() block');
      }
      currentSuite.tests.push(createTest(name, fn, 'skipped'));
    },
    only: (name: string, fn: TestFn) => {
      const currentSuite = getCurrentSuite();
      if (!currentSuite) {
        throw new Error('test.only() must be called within a describe() block');
      }

      // Mark the suite as having focused tests
      currentSuite._hasFocused = true;

      // Mark all existing tests in this suite as skipped, but preserve todo status
      for (const test of currentSuite.tests) {
        if (test.status !== 'todo') {
          test.status = 'skipped';
        }
      }

      // Add the new focused test
      const newTest = createTest(name, fn, 'active');
      currentSuite.tests.push(newTest);

      // All subsequent tests in this suite will be skipped
      // This happens automatically because of the _hasFocused flag
    },
    todo: (name: string) => {
      const currentSuite = getCurrentSuite();
      if (!currentSuite) {
        throw new Error('test.todo() must be called within a describe() block');
      }
      currentSuite.tests.push(createTest(name, () => {}, 'todo'));
    },
  }
);

export const it = test;

export function beforeAll(fn: TestFn) {
  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new Error('beforeAll() must be called within a describe() block');
  }
  currentSuite.beforeAll.push(fn);
}

export function afterAll(fn: TestFn) {
  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new Error('afterAll() must be called within a describe() block');
  }
  currentSuite.afterAll.push(fn);
}

export function beforeEach(fn: TestFn) {
  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new Error('beforeEach() must be called within a describe() block');
  }
  currentSuite.beforeEach.push(fn);
}

export function afterEach(fn: TestFn) {
  const currentSuite = getCurrentSuite();
  if (!currentSuite) {
    throw new Error('afterEach() must be called within a describe() block');
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
