import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type {
  AppMonitor,
  AppMonitorEvent,
  AppMonitorListener,
  HarnessPlatform,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import type { BridgeServer } from '@react-native-harness/bridge/server';
import { createCrashSupervisor } from '../crash-supervisor.js';
import type { Reporter, ReportableEvent } from '@react-native-harness/bundler-metro';

const mocks = vi.hoisted(() => ({
  createCrashArtifactWriter: vi.fn(() => ({})),
  getBridgeServer: vi.fn(),
  getMetroInstance: vi.fn(),
  isMetroCacheReusable: vi.fn(() => false),
  logMetroCacheReused: vi.fn(),
  logMetroPrewarmCompleted: vi.fn(),
  prewarmMetroBundle: vi.fn(),
}));

vi.mock('@react-native-harness/bundler-metro', () => ({
  getMetroInstance: mocks.getMetroInstance,
  prewarmMetroBundle: mocks.prewarmMetroBundle,
}));

vi.mock('@react-native-harness/bridge/server', () => ({
  getBridgeServer: mocks.getBridgeServer,
}));

vi.mock('@react-native-harness/metro', () => ({
  isMetroCacheReusable: mocks.isMetroCacheReusable,
}));

vi.mock('../logs.js', () => ({
  logMetroCacheReused: mocks.logMetroCacheReused,
  logMetroPrewarmCompleted: mocks.logMetroPrewarmCompleted,
}));

vi.mock('@react-native-harness/tools', async () => {
  const actual =
    await vi.importActual<typeof import('@react-native-harness/tools')>(
      '@react-native-harness/tools'
    );

  return {
    ...actual,
    createCrashArtifactWriter: mocks.createCrashArtifactWriter,
  };
});

import { getHarness, waitForAppReady } from '../harness.js';
import { StartupStallError } from '../errors.js';

const createBridgeServer = () => {
  const emitter = new EventEmitter();

  return {
    serverBridge: {
      rpc: {
        clients: [],
      },
      on: emitter.on.bind(emitter),
      once: emitter.once.bind(emitter),
      off: emitter.off.bind(emitter),
      dispose: vi.fn(),
    } as unknown as BridgeServer,
    emitReady: () => {
      emitter.emit('ready', {
        platform: 'ios',
        manufacturer: 'Apple',
        model: 'Simulator',
        osVersion: '18.0',
      });
    },
  };
};

const createMetroReporter = (): {
  reporter: Reporter;
  emit: (event: ReportableEvent) => void;
} => {
  const listeners = new Set<(event: ReportableEvent) => void>();

  return {
    reporter: {
      addListener: (listener) => {
        listeners.add(listener);
      },
      removeListener: (listener) => {
        listeners.delete(listener);
      },
      emit: (event) => {
        listeners.forEach((listener) => listener(event));
      },
      clearAllListeners: () => {
        listeners.clear();
      },
    },
    emit: (event) => {
      listeners.forEach((listener) => listener(event));
    },
  };
};

const createAppMonitor = (): {
  appMonitor: AppMonitor;
  emit: (event: AppMonitorEvent) => void;
} => {
  const listeners = new Set<AppMonitorListener>();

  return {
    appMonitor: {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      addListener: (listener) => {
        listeners.add(listener);
      },
      removeListener: (listener) => {
        listeners.delete(listener);
      },
    },
    emit: (event) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
};

const createPlatformRunner = (
  overrides: Partial<HarnessPlatformRunner> = {}
): HarnessPlatformRunner => ({
  startApp: vi.fn(async () => undefined),
  restartApp: vi.fn(async () => undefined),
  stopApp: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  isAppRunning: vi.fn(async () => true),
  createAppMonitor: () => createAppMonitor().appMonitor,
  ...overrides,
});

const createHarnessConfig = (
  overrides: Partial<HarnessConfig> = {}
): HarnessConfig =>
  ({
    appRegistryComponentName: 'App',
    bridgeTimeout: 60_000,
    bundleStartTimeout: 1_000,
    crashDetectionInterval: 500,
    defaultRunner: 'ios',
    detectNativeCrashes: true,
    disableViewFlattening: false,
    entryPoint: 'index.js',
    forwardClientLogs: false,
    maxAppRestarts: 2,
    resetEnvironmentBetweenTestFiles: true,
    runners: [],
    unstable__enableMetroCache: false,
    unstable__skipAlreadyIncludedModules: false,
    webSocketPort: 8081,
    ...overrides,
  }) as HarnessConfig;

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  delete (
    globalThis as typeof globalThis & {
      __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
    }
  ).__HARNESS_PLATFORM_RUNNER__;
});

describe('waitForAppReady', () => {
  it('retries startup when Metro is idle and passes launch options on every attempt', async () => {
    vi.useFakeTimers();

    const { serverBridge, emitReady } = createBridgeServer();
    const { reporter } = createMetroReporter();
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const platformInstance = createPlatformRunner({ restartApp });
    const { appMonitor } = createAppMonitor();
    const crashSupervisor = createCrashSupervisor({
      appMonitor,
      platformRunner: platformInstance,
    });

    const promise = waitForAppReady({
      metroEvents: reporter,
      serverBridge,
      platformInstance,
      bundleStartTimeout: 1_000,
      maxAppRestarts: 2,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
      appLaunchOptions: {
        extras: {
          mode: 'startup',
        },
      },
    });

    await flush();
    expect(restartApp).toHaveBeenCalledTimes(1);
    expect(restartApp).toHaveBeenNthCalledWith(1, {
      extras: {
        mode: 'startup',
      },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(restartApp).toHaveBeenCalledTimes(2);
    expect(restartApp).toHaveBeenNthCalledWith(2, {
      extras: {
        mode: 'startup',
      },
    });

    emitReady();
    await promise;
    await crashSupervisor.dispose();
  });

  it('does not retry while Metro is still bundling', async () => {
    vi.useFakeTimers();

    const { serverBridge, emitReady } = createBridgeServer();
    const { reporter, emit } = createMetroReporter();
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const platformInstance = createPlatformRunner({ restartApp });
    const { appMonitor } = createAppMonitor();
    const crashSupervisor = createCrashSupervisor({
      appMonitor,
      platformRunner: platformInstance,
    });

    const promise = waitForAppReady({
      metroEvents: reporter,
      serverBridge,
      platformInstance,
      bundleStartTimeout: 1_000,
      maxAppRestarts: 2,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
    });

    emit({
      type: 'bundle_build_started',
      buildID: 'startup',
      bundleDetails: { entryFile: 'index.js', platform: 'ios', dev: true, minify: false, bundleType: 'bundle' },
    } as ReportableEvent);

    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(restartApp).toHaveBeenCalledTimes(1);

    emitReady();
    await promise;
    await crashSupervisor.dispose();
  });

  it('resumes retries once bundling finishes', async () => {
    vi.useFakeTimers();

    const { serverBridge, emitReady } = createBridgeServer();
    const { reporter, emit } = createMetroReporter();
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const platformInstance = createPlatformRunner({ restartApp });
    const { appMonitor } = createAppMonitor();
    const crashSupervisor = createCrashSupervisor({
      appMonitor,
      platformRunner: platformInstance,
    });

    const promise = waitForAppReady({
      metroEvents: reporter,
      serverBridge,
      platformInstance,
      bundleStartTimeout: 1_000,
      maxAppRestarts: 2,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
    });

    emit({
      type: 'bundle_build_started',
      buildID: 'startup',
      bundleDetails: { entryFile: 'index.js', platform: 'ios', dev: true, minify: false, bundleType: 'bundle' },
    } as ReportableEvent);

    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(restartApp).toHaveBeenCalledTimes(1);

    emit({
      type: 'bundle_build_done',
      buildID: 'startup',
    } as ReportableEvent);

    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(restartApp).toHaveBeenCalledTimes(2);

    emitReady();
    await promise;
    await crashSupervisor.dispose();
  });

  it('throws a startup stall error when all launch attempts are exhausted', async () => {
    vi.useFakeTimers();

    const { serverBridge } = createBridgeServer();
    const { reporter } = createMetroReporter();
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const platformInstance = createPlatformRunner({ restartApp });
    const { appMonitor } = createAppMonitor();
    const crashSupervisor = createCrashSupervisor({
      appMonitor,
      platformRunner: platformInstance,
    });

    const promise = waitForAppReady({
      metroEvents: reporter,
      serverBridge,
      platformInstance,
      bundleStartTimeout: 1_000,
      maxAppRestarts: 2,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
    });
    const expectation = expect(promise).rejects.toEqual(
      expect.objectContaining({
        name: 'StartupStallError',
        message:
          'The app never became ready after 3 launch attempts with a startup stall timeout of 1000ms and no native crash signal.',
      })
    );

    await flush();
    await vi.advanceTimersByTimeAsync(3_000);

    await expectation;
    expect(restartApp).toHaveBeenCalledTimes(3);

    await crashSupervisor.dispose();
  });

  it('fails immediately on a confirmed startup crash', async () => {
    const { serverBridge } = createBridgeServer();
    const { reporter } = createMetroReporter();
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const platformInstance = createPlatformRunner({ restartApp });
    const { appMonitor, emit } = createAppMonitor();
    const crashSupervisor = createCrashSupervisor({
      appMonitor,
      platformRunner: {
        ...platformInstance,
        isAppRunning: vi.fn(async () => false),
      },
    });

    const promise = waitForAppReady({
      metroEvents: reporter,
      serverBridge,
      platformInstance,
      bundleStartTimeout: 1_000,
      maxAppRestarts: 2,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
    });

    await flush();

    emit({
      type: 'app_exited',
      source: 'polling',
      isConfirmed: true,
      pid: 123,
      crashDetails: {
        summary: 'fatal startup crash',
      },
    } as AppMonitorEvent);

    await expect(promise).rejects.toMatchObject({
      name: 'NativeCrashError',
      phase: 'startup',
    });
    expect(restartApp).toHaveBeenCalledTimes(1);

    await crashSupervisor.dispose();
  });

  it('stops retrying once a crash is reported after an earlier stall', async () => {
    vi.useFakeTimers();

    const { serverBridge } = createBridgeServer();
    const { reporter } = createMetroReporter();
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const platformInstance = createPlatformRunner({ restartApp });
    const { appMonitor, emit } = createAppMonitor();
    const crashSupervisor = createCrashSupervisor({
      appMonitor,
      platformRunner: {
        ...platformInstance,
        isAppRunning: vi.fn(async () => false),
      },
    });

    const promise = waitForAppReady({
      metroEvents: reporter,
      serverBridge,
      platformInstance,
      bundleStartTimeout: 1_000,
      maxAppRestarts: 2,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
    });

    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(restartApp).toHaveBeenCalledTimes(2);

    emit({
      type: 'possible_crash',
      source: 'polling',
      isConfirmed: true,
      pid: 456,
      crashDetails: {
        summary: 'crashed on retry',
      },
    } as AppMonitorEvent);

    await expect(promise).rejects.toMatchObject({
      name: 'NativeCrashError',
      phase: 'startup',
    });
    expect(restartApp).toHaveBeenCalledTimes(2);

    await crashSupervisor.dispose();
  });
});

describe('restart(testFilePath)', () => {
  it('stops the app and relaunches through the shared startup recovery helper', async () => {
    vi.useFakeTimers();

    const { serverBridge, emitReady } = createBridgeServer();
    const appMonitor = createAppMonitor();
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const stopApp = vi.fn().mockResolvedValue(undefined);
    const platformInstance = createPlatformRunner({
      restartApp,
      stopApp,
      createAppMonitor: () => appMonitor.appMonitor,
    });

    mocks.getBridgeServer.mockResolvedValue(serverBridge);
    const metroReporter = createMetroReporter();
    mocks.getMetroInstance.mockResolvedValue({
      events: metroReporter.reporter,
      dispose: vi.fn(async () => undefined),
    });
    mocks.prewarmMetroBundle.mockResolvedValue(undefined);

    (
      globalThis as typeof globalThis & {
        __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
      }
    ).__HARNESS_PLATFORM_RUNNER__ = vi.fn(async () => platformInstance);

    const platform: HarnessPlatform = {
      config: {
        appLaunchOptions: {
          extras: {
            source: 'restart',
          },
        },
      },
      name: 'ios',
      platformId: 'ios',
      runner: `data:text/javascript,${encodeURIComponent(
        'export default (...args) => globalThis.__HARNESS_PLATFORM_RUNNER__(...args);'
      )}`,
    };

    const harness = await getHarness(
      createHarnessConfig({
        bundleStartTimeout: 1_000,
        maxAppRestarts: 2,
      }),
      platform,
      '/tmp/project'
    );

    const restartPromise = harness.restart('/tmp/restart.harness.ts');

    await flush();
    await flush();

    expect(stopApp).toHaveBeenCalledTimes(1);
    expect(restartApp).toHaveBeenCalledTimes(1);
    expect(restartApp).toHaveBeenNthCalledWith(1, {
      extras: {
        source: 'restart',
      },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(restartApp).toHaveBeenCalledTimes(2);
    expect(restartApp).toHaveBeenNthCalledWith(2, {
      extras: {
        source: 'restart',
      },
    });

    emitReady();
    await restartPromise;
    await harness.dispose();
  });
});

describe('StartupStallError', () => {
  it('includes the configured timeout and attempt count', () => {
    expect(new StartupStallError(1_500, 4).message).toBe(
      'The app never became ready after 4 launch attempts with a startup stall timeout of 1500ms and no native crash signal.'
    );
  });
});
