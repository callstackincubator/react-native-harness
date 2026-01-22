import type {
  TestRunnerEvents,
  TestCollectorEvents,
  BundlerEvents,
  TestExecutionOptions,
  ConsoleLevel,
  ConsoleEvent,
} from '@react-native-harness/bridge';
import { getBridgeClient } from '@react-native-harness/bridge/client';
import { store } from '../ui/state.js';
import { getTestRunner, TestRunner } from '../runner/index.js';
import { getTestCollector, TestCollector } from '../collector/index.js';
import { combineEventEmitters, EventEmitter } from '../utils/emitter.js';
import { getWSServer } from './getWSServer.js';
import { getBundler, evaluateModule, Bundler } from '../bundler/index.js';
import { markTestsAsSkippedByName } from '../filtering/index.js';
import { setup } from '../render/setup.js';
import { runSetupFiles } from './setup-files.js';
import { setClient } from './store.js';

type EmitEventFn = (type: ConsoleEvent['type'], data: ConsoleEvent) => void;

// Console forwarding setup - intercepts console calls and emits events to host
const setupConsoleForwarding = (emitEvent: EmitEventFn): (() => void) => {
  const originalConsole: Record<ConsoleLevel, typeof console.log> = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  const createForwarder =
    (level: ConsoleLevel) =>
    (...args: unknown[]) => {
      // Call original console method
      originalConsole[level](...args);

      // Forward to host via bridge
      try {
        emitEvent('console', {
          type: 'console',
          level,
          args: args.map((arg) => {
            try {
              if (arg instanceof Error) {
                return arg.stack ?? `${arg.name}: ${arg.message}`;
              }
              if (typeof arg === 'object' && arg !== null) {
                return JSON.stringify(arg);
              }
              return String(arg);
            } catch {
              return String(arg);
            }
          }),
          timestamp: Date.now(),
        });
      } catch {
        // Ignore errors during forwarding to avoid infinite loops
      }
    };

  console.log = createForwarder('log');
  console.warn = createForwarder('warn');
  console.error = createForwarder('error');
  console.info = createForwarder('info');
  console.debug = createForwarder('debug');

  // Return cleanup function to restore original console
  return () => {
    Object.assign(console, originalConsole);
  };
};

export const getClient = async () => {
  const client = await getBridgeClient(getWSServer(), {
    runTests: async () => {
      throw new Error('Not implemented');
    },
  });

  setClient(client);

  client.rpc.$functions.runTests = async (
    path: string,
    options: TestExecutionOptions
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
    let cleanupConsole: (() => void) | null = null;

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

      // Setup console forwarding to emit console events to host
      cleanupConsole = setupConsoleForwarding((type, data) => {
        client.rpc.emitEvent(type, data);
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

        // Setup automatic cleanup for rendered components
        setup();
        evaluateModule(moduleJs, path);
      }, path);

      // Apply test name pattern by marking non-matching tests as skipped
      const processedTestSuite = options.testNamePattern
        ? markTestsAsSkippedByName(
            collectionResult.testSuite,
            options.testNamePattern
          )
        : collectionResult.testSuite;

      const result = await runner.run({
        testSuite: processedTestSuite,
        testFilePath: path,
        runner: options.runner,
      });
      return result;
    } finally {
      // Restore original console
      cleanupConsole?.();
      collector?.dispose();
      runner?.dispose();
      events?.clearAllListeners();
      store.getState().setStatus('idle');
    }
  };

  return client;
};
