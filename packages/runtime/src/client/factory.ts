import type {
  TestRunnerEvents,
  TestCollectorEvents,
  BundlerEvents,
  TestExecutionOptions,
} from '@react-native-harness/bridge';
import {
  connectToHarness,
  type HarnessHandle,
} from '@react-native-harness/bridge/client';
import { store } from '../ui/state.js';
import { getTestRunner, TestRunner } from '../runner/index.js';
import { getTestCollector, TestCollector } from '../collector/index.js';
import { combineEventEmitters, EventEmitter } from '../utils/emitter.js';
import { getWSServer } from './getWSServer.js';
import { getBundler, evaluateModule, Bundler } from '../bundler/index.js';
import { markTestsAsSkippedByName } from '../filtering/index.js';
import { setup } from '../render/setup.js';
import { runSetupFiles } from './setup-files.js';
import { setHandle } from './store.js';
import { installPromiseTracker } from '../promise-tracker.js';

export const getClient = async (): Promise<HarnessHandle> => {
  const handle = await connectToHarness(getWSServer(), {
    runTests: async (path: string, options: TestExecutionOptions) => {
      installPromiseTracker();

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
          handle.emitEvent(event);
        });

        await runSetupFiles({
          setupFiles: options.setupFiles ?? [],
          setupFilesAfterEnv: [],
          events: events as EventEmitter<BundlerEvents>,
          bundler: bundler as Bundler,
          evaluateModule,
        });

        const moduleJs = await bundler.getModule(path);
        const collectionResult = await collector.collect(async () => {
          await runSetupFiles({
            setupFiles: [],
            setupFilesAfterEnv: options.setupFilesAfterEnv ?? [],
            events: events as EventEmitter<BundlerEvents>,
            bundler: bundler as Bundler,
            evaluateModule,
          });

          setup();
          evaluateModule(moduleJs, path);
        }, path);

        const processedTestSuite = options.testNamePattern
          ? markTestsAsSkippedByName(
              collectionResult.testSuite,
              options.testNamePattern
            )
          : collectionResult.testSuite;

        return await runner.run({
          testSuite: processedTestSuite,
          testFilePath: path,
          runner: options.runner,
          testTimeout: options.testTimeout,
        });
      } finally {
        collector?.dispose();
        runner?.dispose();
        events?.clearAllListeners();
        store.getState().setStatus('idle');
      }
    },
  });

  setHandle(handle);
  return handle;
};
