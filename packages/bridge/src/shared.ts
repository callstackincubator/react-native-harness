import type {
  TestRunnerEvents,
  TestSuiteResult,
} from './shared/test-runner.js';
import type { TestCollectorEvents } from './shared/test-collector.js';
import type { BundlerEvents } from './shared/bundler.js';
import type { HarnessPlatform } from '@react-native-harness/platforms';

export type FileReference = {
  path: string;
};

export type ImageSnapshotOptions = {
  /**
   * The name of the snapshot. This is required and must be unique within the test.
   */
  name: string;
  /**
   * Comparison algorithm to use.
   * @default 'pixelmatch'
   */
  comparisonMethod?: 'pixelmatch' | 'ssim';
  /**
   * Matching threshold for pixelmatch, ranges from 0 to 1. Smaller values make the comparison more sensitive.
   * @default 0.1
   */
  threshold?: number;
  /**
   * Threshold for test failure.
   */
  failureThreshold?: number;
  /**
   * Type of failure threshold.
   * @default 'pixel'
   */
  failureThresholdType?: 'pixel' | 'percent';
  /**
   * Minimum similarity score for SSIM comparison (0-1).
   * @default 0.95
   */
  ssimThreshold?: number;
  /**
   * Regions to ignore during comparison.
   */
  ignoreRegions?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  /**
   * If true, disables detecting and ignoring anti-aliased pixels.
   * @default false
   */
  includeAA?: boolean;
  /**
   * Blending factor of unchanged pixels in the diff output.
   * Ranges from 0 for pure white to 1 for original brightness
   * @default 0.1
   */
  alpha?: number;
  /**
   * The color of differing pixels in the diff output.
   * @default [255, 0, 0]
   */
  diffColor?: [number, number, number];
  /**
   * An alternative color to use for dark on light differences to differentiate between "added" and "removed" parts.
   * If not provided, all differing pixels use the color specified by `diffColor`.
   * @default null
   */
  diffColorAlt?: [number, number, number];
};

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
  platform: 'ios' | 'android' | 'vega' | 'web';
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
  runner: string;
};

export type BridgeClientFunctions = {
  runTests: (
    path: string,
    options: TestExecutionOptions
  ) => Promise<TestSuiteResult>;
};

export type BinaryDataReference = {
  type: 'binary';
  transferId: number;
  size: number;
  mimeType: 'image/png';
};

export type ScreenshotData = BinaryDataReference;

export type BridgeServerFunctions = {
  reportReady: (device: DeviceDescriptor) => void;
  emitEvent: <TEvent extends BridgeEvents>(
    event: TEvent['type'],
    data: TEvent
  ) => void;
  'device.screenshot.receive': (
    reference: BinaryDataReference,
    metadata: { width: number; height: number }
  ) => Promise<FileReference>;
  'test.matchImageSnapshot': (
    screenshot: FileReference,
    testPath: string,
    options: ImageSnapshotOptions,
    runner: string
  ) => Promise<{ pass: boolean; message: string }>;
};

export type HarnessContext = {
  platform: HarnessPlatform;
};
