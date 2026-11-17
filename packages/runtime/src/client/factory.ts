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
import { getBundler, Bundler } from '../bundler/index.js';
import type { LoadedModule } from '../module-system.js';
import { getHost } from '../host.js';
import { markTestsAsSkippedByName } from '../filtering/index.js';
import { setup } from '../render/setup.js';
import { runSetupFiles } from './setup-files.js';
import { setHandle } from './store.js';
import { installPromiseTracker } from '../promise-tracker.js';
import { beginTestHostSession } from '../host-surface.js';

// Reloading tears down the JS runtime, so the RPC caller would never see a
// response if we reloaded synchronously. Acknowledge first, then reload on
// the next tick so the response has a chance to flush over the bridge.
const reloadRuntime = (): void => {
  setTimeout(() => {
    getHost().reloadRuntime();
  }, 100);
};

export const getClient = async (): Promise<HarnessHandle> => {
  const handle = await connectToHarness(getWSServer(), {
    resetEnvironment: async () => {
      reloadRuntime();
    },
    runTests: async (path: string, options: TestExecutionOptions) => {
      installPromiseTracker();

      if (store.getState().status === 'running') {
        throw new Error('Already running tests');
      }

      const hostSession = beginTestHostSession(path);
      store.getState().setStatus('running');

      let collector: TestCollector | null = null;
      let runner: TestRunner | null = null;
      let events: EventEmitter<
        TestRunnerEvents | TestCollectorEvents | BundlerEvents
      > | null = null;
      let bundler: Bundler | null = null;
      const runForHost = async (module: LoadedModule): Promise<void> => {
        hostSession.throwIfInterrupted();
        await hostSession.run(() => module.run());
        hostSession.throwIfInterrupted();
      };

      try {
        const fileCollector = collector = getTestCollector();
        const fileRunner = runner = getTestRunner();
        const fileBundler = bundler = getBundler();
        events = combineEventEmitters(
          fileCollector.events,
          fileRunner.events,
          fileBundler.events
        );
        events.addListener((event) => {
          handle.emitEvent(event);
        });

        return await hostSession.run(async () => {
          await runSetupFiles({
            setupFiles: options.setupFiles ?? [],
            setupFilesAfterEnv: [],
            events: fileBundler.events,
            bundler: fileBundler,
            runModule: runForHost,
          });
          hostSession.throwIfInterrupted();

          const loadedModule = await fileBundler.getModule(path);
          hostSession.throwIfInterrupted();
          const collectionResult = await fileCollector.collect(async () => {
            hostSession.throwIfInterrupted();
            await runSetupFiles({
              setupFiles: [],
              setupFilesAfterEnv: options.setupFilesAfterEnv ?? [],
              events: fileBundler.events,
              bundler: fileBundler,
              runModule: runForHost,
            });
            hostSession.throwIfInterrupted();

            setup();
            await runForHost(loadedModule);
            hostSession.throwIfInterrupted();
          }, path);
          hostSession.throwIfInterrupted();

          const processedTestSuite = options.testNamePattern
            ? markTestsAsSkippedByName(
                collectionResult.testSuite,
                options.testNamePattern
              )
            : collectionResult.testSuite;

          return await fileRunner.run({
            testSuite: processedTestSuite,
            testFilePath: path,
            runner: options.runner,
            testTimeout: options.testTimeout,
          });
        });
      } finally {
        hostSession.dispose();
        try {
          // Free this file's Metro graph so graphs don't accumulate per file (OOM).
          const release = bundler?.releaseModule(path);
          if (hostSession.interrupted) {
            void release?.catch(() => undefined);
          } else {
            await release;
          }
        } finally {
          collector?.dispose();
          runner?.dispose();
          events?.clearAllListeners();
          store.getState().setStatus('idle');
        }
      }
    },
  });

  setHandle(handle);
  return handle;
};
