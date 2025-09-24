export type CodeFrame = {
  content: string;
  location?: {
    row: number;
    column: number;
  };
  fileName: string;
};

export type TestResultStatus = 'passed' | 'failed' | 'skipped' | 'todo';

export type SerializedError = {
  name: string;
  message: string;
  codeFrame?: CodeFrame;
};

export type TestRunnerFileStartedEvent = {
  type: 'file-started';
  file: string;
};

export type TestRunnerFileFinishedEvent = {
  type: 'file-finished';
  file: string;
  duration: number;
};

export type TestRunnerSuiteStartedEvent = {
  type: 'suite-started';
  name: string;
  file: string;
};

export type TestRunnerTestStartedEvent = {
  type: 'test-started';
  name: string;
  suite: string;
  file: string;
};

export type TestRunnerTestFinishedEvent = {
  type: 'test-finished';
  name: string;
  suite: string;
  file: string;
  duration: number;
  error?: SerializedError;
  status: TestResultStatus;
};

export type TestRunnerSuiteFinishedEvent = {
  type: 'suite-finished';
  name: string;
  file: string;
  duration: number;
  error?: SerializedError;
  status: TestResultStatus;
};

export type TestRunnerEvents =
  | TestRunnerFileStartedEvent
  | TestRunnerFileFinishedEvent
  | TestRunnerTestStartedEvent
  | TestRunnerTestFinishedEvent
  | TestRunnerSuiteStartedEvent
  | TestRunnerSuiteFinishedEvent;

export type TestResult = {
  name: string;
  status: TestResultStatus;
  error?: SerializedError;
  duration: number;
};

export type TestSuiteResult = {
  name: string;
  tests: TestResult[];
  suites: TestSuiteResult[];
  status: TestResultStatus;
  error?: SerializedError;
  duration: number;
};
