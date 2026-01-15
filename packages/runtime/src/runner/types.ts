import { EventEmitter } from '../utils/emitter.js';
import type {
  TestRunnerEvents,
  TestSuite,
  TestSuiteResult,
} from '@react-native-harness/bridge';

export type TestRunnerEventsEmitter = EventEmitter<TestRunnerEvents>;

export type TestRunnerContext = {
  events: TestRunnerEventsEmitter;
  testFilePath: string;
};

export type RunTestsOptions = {
  testSuite: TestSuite;
  testFilePath: string;
  runner: string;
};

export type TestRunner = {
  events: TestRunnerEventsEmitter;
  run: (options: RunTestsOptions) => Promise<TestSuiteResult>;
  dispose: () => void;
};
