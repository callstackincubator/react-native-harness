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

export type CollectionResult = {
  testSuite: TestSuite;
  /** Number of tests that will actually be executed (excludes skipped and todo tests) */
  totalTests: number;
};

export type TestCollectionStartedEvent = {
  type: 'collection-started';
  file: string;
};

export type TestCollectionFinishedEvent = {
  type: 'collection-finished';
  file: string;
  duration: number;
};

export type TestCollectorEvents =
  | TestCollectionStartedEvent
  | TestCollectionFinishedEvent;
