import type {
  TestRunnerEvents,
  TestCollectorEvents,
} from '@react-native-harness/bridge';
import { getBridgeClient } from '@react-native-harness/bridge/client';
import { store } from '../ui/state.js';
import { getTestRunner, TestRunner } from '../runner/index.js';
import { getTestCollector, TestCollector } from '../collector/index.js';
import { combineEventEmitters, EventEmitter } from '../utils/emitter.js';
import { attachProgressLogger } from '../utils/progressLogger.js';
import { getWSServer } from './getWSServer.js';
import { fetchModule, evaluateModule } from '../bundler/index.js';

export const getClient = async () => {
  const client = await getBridgeClient(getWSServer(), {
    runTests: async () => {
      throw new Error('Not implemented');
    },
  });

  client.rpc.$functions.runTests = async (path: string) => {
    if (store.getState().status === 'running') {
      throw new Error('Already running tests');
    }

    store.getState().setStatus('running');

    let collector: TestCollector | null = null;
    let runner: TestRunner | null = null;
    let events: EventEmitter<TestRunnerEvents | TestCollectorEvents> | null =
      null;

    try {
      collector = getTestCollector();
      runner = getTestRunner();
      events = combineEventEmitters(collector.events, runner.events);

      events.addListener((event) => {
        client.rpc.emitEvent(event.type, event);
      });

      // Add console logging for progress information
      attachProgressLogger(events, path);

      const moduleJs = await fetchModule(path);
      const collectionResult = await collector.collect(
        () => evaluateModule(moduleJs, path),
        path
      );
      const result = await runner.run(collectionResult.testSuite, path);
      return result;
    } catch (error) {
      throw error;
    } finally {
      collector?.dispose();
      runner?.dispose();
      events?.clearAllListeners();
      store.getState().setStatus('idle');
    }
  };

  return client;
};
