import { EventEmitter } from '../utils/emitter.js';
import type {
  HarnessTestContext,
  TestRunnerEvents,
  TestSuite,
  TestSuiteResult,
} from '@react-native-harness/bridge';

export type TestRunnerEventsEmitter = EventEmitter<TestRunnerEvents>;

export type TestRunnerContext = {
  events: TestRunnerEventsEmitter;
  testFilePath: string;
  testTimeout?: number;
};

export type ActiveTestContext = HarnessTestContext;

export type RunTestsOptions = {
  testSuite: TestSuite;
  testFilePath: string;
  runner: string;
  testTimeout?: number;
};

export type TestRunner = {
  events: TestRunnerEventsEmitter;
  run: (options: RunTestsOptions) => Promise<TestSuiteResult>;
  dispose: () => void;
};
