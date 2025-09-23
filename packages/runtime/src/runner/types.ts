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

export type TestRunner = {
  events: TestRunnerEventsEmitter;
  run: (testSuite: TestSuite, testFilePath: string) => Promise<TestSuiteResult>;
  dispose: () => void;
};
