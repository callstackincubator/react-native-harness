import {
  ActionExecutor,
  QueryExecutor,
  MatcherExecutor,
} from '@react-native-harness/interaction-engine';

export type TestResultStatus = 'passed' | 'failed' | 'skipped' | 'todo';

export interface TestResult {
  name: string;
  status: TestResultStatus;
  error?: Error;
  duration?: number;
}

export interface SuiteResult {
  name: string;
  tests: TestResult[];
  suites: SuiteResult[];
  status: TestResultStatus;
  error?: Error;
  duration?: number;
}

export type BridgeClientFunctions = {
  runTests: (path: string) => Promise<SuiteResult>;
};

export type BridgeServerFunctions = {
  reportReady: () => void;
  executeAction: ActionExecutor;
  executeQuery: QueryExecutor;
  executeMatcher: MatcherExecutor;
};
