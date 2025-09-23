import { EventEmitter } from '../utils/emitter.js';
import {
  TestCollectorEvents,
  CollectionResult,
} from '@react-native-harness/bridge';

export type TestFn = () => void | Promise<void>;

export type TestCollectorEventsEmitter = EventEmitter<TestCollectorEvents>;

export type TestCollector = {
  events: TestCollectorEventsEmitter;
  collect: (fn: () => void, testFilePath: string) => Promise<CollectionResult>;
  dispose: () => void;
};
