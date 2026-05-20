import { EventEmitter } from '../utils/emitter.js';
import {
  TestCollectorEvents,
  CollectionResult,
  type HarnessTestContext,
} from '@react-native-harness/bridge';

export type TestFn = (context: HarnessTestContext) => void | Promise<void>;

export type SuiteHookFn = () => void | Promise<void>;

export type TestCollectorEventsEmitter = EventEmitter<TestCollectorEvents>;

export type TestCollector = {
  events: TestCollectorEventsEmitter;
  collect: (
    fn: () => void | Promise<void>,
    testFilePath: string
  ) => Promise<CollectionResult>;
  dispose: () => void;
};
