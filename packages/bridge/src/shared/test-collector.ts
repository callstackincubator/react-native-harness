import type { HarnessTestContext } from './test-context.js';

export type TestStatus = 'active' | 'skipped' | 'todo';

export type TestDeclarationMode = 'only' | 'skip' | 'todo';

export type TestFn = (context: HarnessTestContext) => void | Promise<void>;

export type SuiteHookFn = () => void | Promise<void>;

export type TestCase = {
  name: string;
  fn: TestFn;
  status: TestStatus;
  declarationMode?: TestDeclarationMode;
};

export type TestSuite = {
  name: string;
  tests: TestCase[];
  suites: TestSuite[];
  parent?: TestSuite;
  beforeAll: SuiteHookFn[];
  afterAll: SuiteHookFn[];
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
  totalTests: number;
};

export type TestCollectorEvents =
  | TestCollectionStartedEvent
  | TestCollectionFinishedEvent;
