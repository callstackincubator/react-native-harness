import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toolMocks = vi.hoisted(() => ({
  createCrashArtifactWriter: vi.fn(() => ({
    persistArtifact: vi.fn(() => '/tmp/harness-artifact'),
  })),
  createHarnessBridge: vi.fn(),
  createHarnessPluginManager: vi.fn(),
  createHookQueue: vi.fn(),
  createClientLogCollector: vi.fn(),
  createCrashMonitor: vi.fn(),
  getConfig: vi.fn(),
  getMetroInstance: vi.fn(),
  getAdditionalCliArgs: vi.fn(),
  logNoop: vi.fn(),
  lockAcquire: vi.fn(),
  processExit: vi.fn(),
  processOff: vi.fn(),
  processOnce: vi.fn(),
  resolveHarnessMetroPort: vi.fn(),
  runnerFactory: vi.fn(),
}));

vi.mock('@react-native-harness/config', () => ({
  ConfigSchema: {
    parse: vi.fn((value) => value),
  },
  getConfig: toolMocks.getConfig,
}));

vi.mock('@react-native-harness/bundler-metro', () => ({
  getMetroInstance: toolMocks.getMetroInstance,
  isMetroCacheReusable: vi.fn(() => false),
  waitForMetroBackedAppReady: vi.fn(),
}));

vi.mock('@react-native-harness/bridge/server', () => ({
  createHarnessBridge: toolMocks.createHarnessBridge,
}));

vi.mock('@react-native-harness/plugins', () => ({
  createHarnessPluginManager: toolMocks.createHarnessPluginManager,
}));

vi.mock('@react-native-harness/tools', async () => {
  const actual = await vi.importActual<typeof import('@react-native-harness/tools')>(
    '@react-native-harness/tools',
  );

  return {
    ...actual,
    createCrashArtifactWriter: toolMocks.createCrashArtifactWriter,
  };
});

vi.mock('jest-util', () => ({
  preRunMessage: {
    remove: vi.fn(),
  },
}));

vi.mock('../action-hooks.js', () => ({
  createActionHooksPlugin: vi.fn(() => ({})),
}));

vi.mock('../client-log-handler.js', () => ({
  createClientLogCollector: toolMocks.createClientLogCollector,
}));

vi.mock('../crash-monitor.js', () => ({
  createCrashMonitor: toolMocks.createCrashMonitor,
}));

vi.mock('../hook-queue.js', () => ({
  createHookQueue: toolMocks.createHookQueue,
}));

vi.mock('../cli-args.js', () => ({
  getAdditionalCliArgs: toolMocks.getAdditionalCliArgs,
}));

vi.mock('../logs.js', () => ({
  logMetroCacheReused: toolMocks.logNoop,
  logMetroPortFallback: toolMocks.logNoop,
  logNativeCoverageCollected: toolMocks.logNoop,
  logRunnerStarting: toolMocks.logNoop,
  logRunnerStillWaitingInQueue: toolMocks.logNoop,
  logRunnerWaitingInQueue: toolMocks.logNoop,
  logTestEnvironmentReady: toolMocks.logNoop,
  logTestRunHeader: toolMocks.logNoop,
}));

vi.mock('../metro-port.js', () => ({
  resolveHarnessMetroPort: toolMocks.resolveHarnessMetroPort,
}));

vi.mock('../resource-lock.js', () => ({
  createResourceLockManager: vi.fn(() => ({
    acquire: toolMocks.lockAcquire,
  })),
}));

import {
  createHarnessSession,
  getSignalExitCodeForRunState,
  handleHarnessSignal,
} from '../harness-session.js';

type HarnessTestRunnerContext = {
  signal?: AbortSignal;
};

const signalListeners = new Map<string, () => void>();
const createTempRunnerModule = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-harness-session-'));
  const runnerPath = path.join(root, 'runner.mjs');

  fs.writeFileSync(
    runnerPath,
    [
      'export default async function runner(config, harnessConfig, init) {',
      '  return globalThis.__RN_HARNESS_TEST_RUNNER__(config, harnessConfig, init);',
      '}',
    ].join('\n'),
  );

  return {
    root,
    runnerUrl: pathToFileURL(runnerPath).href,
  };
};

const createHarnessConfig = (runnerUrl: string) => {
  const runnerConfig = {
    name: 'ios',
    platformId: 'ios',
    runner: runnerUrl,
    config: {},
    getResourceLockKey: () => 'test-lock',
  };

  return {
    bridgeTimeout: 1000,
    bundleStartTimeout: 1000,
    defaultRunner: 'ios',
    detectNativeCrashes: true,
    forwardClientLogs: false,
    maxAppRestarts: 1,
    metroPort: 8081,
    permissions: false,
    platformReadyTimeout: 1000,
    plugins: [],
    runners: [runnerConfig],
    unstable__enableMetroCache: false,
  };
};

const createAppSession = () => ({
  addListener: vi.fn(),
  dispose: vi.fn(async () => undefined),
  getCrashDetails: vi.fn(async () => null),
  getLogs: vi.fn(() => []),
  getState: vi.fn(async () => ({ status: 'running' as const })),
  removeListener: vi.fn(),
});

beforeEach(() => {
  signalListeners.clear();
  vi.spyOn(process, 'once').mockImplementation(
    (event: string | symbol, listener: (...args: unknown[]) => void) => {
      signalListeners.set(String(event), listener);
      return process;
    },
  );
  vi.spyOn(process, 'off').mockImplementation(
    (event: string | symbol, listener: (...args: unknown[]) => void) => {
      if (signalListeners.get(String(event)) === listener) {
        signalListeners.delete(String(event));
      }
      return process;
    },
  );
  toolMocks.getAdditionalCliArgs.mockReturnValue({});
  toolMocks.lockAcquire.mockResolvedValue({ release: vi.fn(async () => undefined) });
  toolMocks.resolveHarnessMetroPort.mockImplementation(async ({ config }) => ({
    config,
    didFallback: false,
    initialMetroPort: config.metroPort,
    metroPortLease: {
      release: vi.fn(async () => undefined),
    },
  }));
  toolMocks.createHarnessBridge.mockResolvedValue({
    connection: null,
    dispose: vi.fn(async () => undefined),
    off: vi.fn(),
    on: vi.fn(),
    ws: {},
  });
  toolMocks.getMetroInstance.mockResolvedValue({
    dispose: vi.fn(async () => undefined),
    events: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  });
  toolMocks.createHarnessPluginManager.mockReturnValue({
    hasPlugins: () => false,
    callHook: vi.fn(async () => undefined),
  });
  toolMocks.createHookQueue.mockReturnValue({
    drain: vi.fn(async () => undefined),
    schedule: vi.fn((task: () => void) => task()),
  });
  toolMocks.createClientLogCollector.mockReturnValue({
    flush: vi.fn(() => []),
    handleEvent: vi.fn(),
  });
  toolMocks.createCrashMonitor.mockReturnValue({
    dispose: vi.fn(async () => undefined),
    handleBridgeDisconnect: vi.fn(),
    isAlive: vi.fn(() => false),
    reset: vi.fn(),
    setAppSession: vi.fn(),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    watch: vi.fn(() => ({
      cancel: vi.fn(),
      promise: Promise.resolve({}),
    })),
  });
  toolMocks.runnerFactory.mockReset();
  toolMocks.getConfig.mockResolvedValue({ config: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as typeof globalThis & {
    __RN_HARNESS_TEST_RUNNER__?: unknown;
  }).__RN_HARNESS_TEST_RUNNER__;
});

describe('createHarnessSession signal flow', () => {
  it('passes session signal into createAppSession and aborts it on dispose', async () => {
    const { root, runnerUrl } = createTempRunnerModule();
    const appSession = createAppSession();
    const createAppSessionMock = vi.fn(async (_options, _context?: HarnessTestRunnerContext) => {
      void _options;
      void _context;
      return appSession;
    });

    (globalThis as typeof globalThis & {
      __RN_HARNESS_TEST_RUNNER__?: typeof toolMocks.runnerFactory;
    }).__RN_HARNESS_TEST_RUNNER__ = toolMocks.runnerFactory.mockImplementation(
      async () => ({
        createAppSession: createAppSessionMock,
        dispose: vi.fn(async () => undefined),
      }),
    );

    toolMocks.getConfig.mockResolvedValue({
      config: createHarnessConfig(runnerUrl),
    });

    try {
      const session = await createHarnessSession({ rootDir: root } as never, {
        lockManager: {
          acquire: toolMocks.lockAcquire,
        } as never,
      });

      await session.restartApp();
      const runState = {
        coverageEnabled: false,
        runId: 'run-1',
        startTime: Date.now(),
        status: 'passed' as const,
        summary: {
          failed: 0,
          passed: 1,
          skipped: 0,
          todo: 0,
        },
        testFiles: ['foo.test.ts'],
        watchMode: false,
      };

      session.setRunState(runState);

      expect(createAppSessionMock).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
      const context = createAppSessionMock.mock.calls[0]?.[1] as
        | HarnessTestRunnerContext
        | undefined;
      expect(context?.signal).toBeInstanceOf(AbortSignal);
      expect(context?.signal?.aborted).toBe(false);

      await session.dispose();

      expect(context?.signal?.aborted).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('maps run state to exit code and aborts controller', async () => {
    const controller = new AbortController();
    const dispose = vi.fn(async () => undefined);
    const exit = vi.fn();
    const failedRun = {
      coverageEnabled: false,
      error: new Error('failed'),
      runId: 'run-2',
      startTime: Date.now(),
      status: 'failed' as const,
      summary: {
        failed: 1,
        passed: 0,
        skipped: 0,
        todo: 0,
      },
      testFiles: ['foo.test.ts'],
      watchMode: false,
    };

    await handleHarnessSignal({
      currentRun: {
        coverageEnabled: false,
        runId: 'run-2',
        startTime: Date.now(),
        status: 'passed',
        summary: {
          failed: 0,
          passed: 1,
          skipped: 0,
          todo: 0,
        },
        testFiles: ['foo.test.ts'],
        watchMode: false,
      },
      dispose,
      exit,
      sessionController: controller,
    });

    expect(controller.signal.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(getSignalExitCodeForRunState(failedRun)).toBe(1);
    expect(getSignalExitCodeForRunState(null)).toBe(1);
  });
});
