import type {
  TestRunnerEvents,
  TestSuiteResult,
} from './shared/test-runner.js';
import type { TestCollectorEvents } from './shared/test-collector.js';
import type { BundlerEvents } from './shared/bundler.js';

export type {
  TestCollectorEvents,
  TestCollectionStartedEvent,
  TestCollectionFinishedEvent,
  TestSuite,
  TestCase,
  CollectionResult,
} from './shared/test-collector.js';
export type {
  TestRunnerEvents,
  TestRunnerFileStartedEvent,
  TestRunnerFileFinishedEvent,
  TestRunnerSuiteStartedEvent,
  TestRunnerTestStartedEvent,
  TestRunnerTestFinishedEvent,
  TestRunnerSuiteFinishedEvent,
  TestSuiteResult,
  TestResult,
  TestResultStatus,
  SerializedError,
  CodeFrame,
} from './shared/test-runner.js';
export type {
  ModuleBundlingStartedEvent,
  ModuleBundlingFinishedEvent,
  ModuleBundlingFailedEvent,
  SetupFileBundlingStartedEvent,
  SetupFileBundlingFinishedEvent,
  SetupFileBundlingFailedEvent,
  BundlerEvents,
} from './shared/bundler.js';

export type DeviceDescriptor = {
  platform: 'ios' | 'android' | 'vega';
  manufacturer: string;
  model: string;
  osVersion: string;
};

export type BridgeEvents =
  | TestCollectorEvents
  | TestRunnerEvents
  | BundlerEvents;

export type BridgeEventsMap = {
  [K in BridgeEvents['type']]: (
    event: Extract<BridgeEvents, { type: K }>
  ) => void;
};

export type TestExecutionOptions = {
  testNamePattern?: string;
  setupFiles?: string[];
  setupFilesAfterEnv?: string[];
};

export type BridgeClientFunctions = {
  runTests: (
    path: string,
    options?: TestExecutionOptions
  ) => Promise<TestSuiteResult>;
};

export type BridgeServerFunctions = {
  reportReady: (device: DeviceDescriptor) => void;
  emitEvent: <TEvent extends BridgeEvents>(
    event: TEvent['type'],
    data: TEvent
  ) => void;
};
