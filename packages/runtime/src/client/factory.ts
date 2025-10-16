import type {
  TestRunnerEvents,
  TestCollectorEvents,
  BundlerEvents,
  TestExecutionOptions,
} from '@react-native-harness/bridge';
import { getBridgeClient } from '@react-native-harness/bridge/client';
import { store } from '../ui/state.js';
import { getTestRunner, TestRunner } from '../runner/index.js';
import { getTestCollector, TestCollector } from '../collector/index.js';
import { combineEventEmitters, EventEmitter } from '../utils/emitter.js';
import { getWSServer } from './getWSServer.js';
import { getBundler, evaluateModule, Bundler } from '../bundler/index.js';
import { markTestsAsSkippedByName } from '../filtering/index.js';

export const getClient = async () => {
  const client = await getBridgeClient(getWSServer(), {
    runTests: async () => {
      throw new Error('Not implemented');
    },
  });

  client.rpc.$functions.runTests = async (
    path: string,
    options: TestExecutionOptions = {}
  ) => {
    if (store.getState().status === 'running') {
      throw new Error('Already running tests');
    }

    store.getState().setStatus('running');

    let collector: TestCollector | null = null;
    let runner: TestRunner | null = null;
    let events: EventEmitter<
      TestRunnerEvents | TestCollectorEvents | BundlerEvents
    > | null = null;
    let bundler: Bundler | null = null;

    try {
      collector = getTestCollector();
      runner = getTestRunner();
      bundler = getBundler();
      events = combineEventEmitters(
        collector.events,
        runner.events,
        bundler.events
      );

      events.addListener((event) => {
        client.rpc.emitEvent(event.type, event);
      });

      const moduleJs = await bundler.getModule(path);
      const collectionResult = await collector.collect(
        () => evaluateModule(moduleJs, path),
        path
      );

      // Apply test name pattern by marking non-matching tests as skipped
      const processedTestSuite = options.testNamePattern
        ? markTestsAsSkippedByName(
            collectionResult.testSuite,
            options.testNamePattern
          )
        : collectionResult.testSuite;

      const result = await runner.run(processedTestSuite, path);
      return result;
    } finally {
      collector?.dispose();
      runner?.dispose();
      events?.clearAllListeners();
      store.getState().setStatus('idle');
    }
  };

  return client;
};
