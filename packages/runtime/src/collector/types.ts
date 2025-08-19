export type TestStatus = 'active' | 'skipped' | 'todo';

export type TestFn = () => void | Promise<void>;

export type TestCase = {
  name: string;
  fn: TestFn;
  status: TestStatus;
};

export type TestSuite = {
  name: string;
  tests: TestCase[];
  suites: TestSuite[];
  parent?: TestSuite;
  beforeAll: TestFn[];
  afterAll: TestFn[];
  beforeEach: TestFn[];
  afterEach: TestFn[];
  status?: TestStatus;
  _hasFocused?: boolean;
};
