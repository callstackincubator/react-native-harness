import { EventEmitter } from 'node:events';
import { HARNESS_BRIDGE_PATH } from '@react-native-harness/bridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import { MetroPortRangeExhaustedError } from '../errors.js';
import { definePlugin } from '@react-native-harness/plugins';
import type {
  AppMonitor,
  AppMonitorEvent,
  AppMonitorListener,
  HarnessPlatform,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import type { BridgeServer } from '@react-native-harness/bridge/server';
import type {
  MetroInstance,
  Reporter,
  ReportableEvent,
  WaitForMetroBackedAppReadyOptions,
} from '@react-native-harness/bundler-metro';
import { createCrashSupervisor } from '../crash-supervisor.js';

const mocks = vi.hoisted(() => ({
  createCrashArtifactWriter: vi.fn(() => ({})),
  getBridgeServer: vi.fn(),
  getMetroInstance: vi.fn(),
  isMetroCacheReusable: vi.fn(() => false),
  logMetroCacheReused: vi.fn(),
  logMetroPortFallback: vi.fn(),
  logRunnerStarting: vi.fn(),
  logRunnerStillWaitingInQueue: vi.fn(),
  logRunnerWaitingInQueue: vi.fn(),
  waitForMetroBackedAppReady: vi.fn(),
  isPortAvailable: vi.fn(async () => true),
}));

vi.mock('@react-native-harness/bundler-metro', async () => {
  const actual = await vi.importActual<
    typeof import('@react-native-harness/bundler-metro')
  >('@react-native-harness/bundler-metro');

  return {
    ...actual,
    getMetroInstance: mocks.getMetroInstance,
    isPortAvailable: mocks.isPortAvailable,
    isMetroCacheReusable: mocks.isMetroCacheReusable,
    waitForMetroBackedAppReady: mocks.waitForMetroBackedAppReady,
  };
});

vi.mock('@react-native-harness/bridge/server', () => ({
  getBridgeServer: mocks.getBridgeServer,
}));

vi.mock('../logs.js', () => ({
  logMetroCacheReused: mocks.logMetroCacheReused,
  logMetroPortFallback: mocks.logMetroPortFallback,
  logRunnerStarting: mocks.logRunnerStarting,
  logRunnerStillWaitingInQueue: mocks.logRunnerStillWaitingInQueue,
  logRunnerWaitingInQueue: mocks.logRunnerWaitingInQueue,
}));

vi.mock('@react-native-harness/tools', async () => {
  const actual = await vi.importActual<
    typeof import('@react-native-harness/tools')
  >('@react-native-harness/tools');

  return {
    ...actual,
    createCrashArtifactWriter: mocks.createCrashArtifactWriter,
  };
});

import { getHarness, waitForAppReady } from '../harness.js';
import { PlatformReadyTimeoutError, StartupStallError } from '../errors.js';

const createBridgeServer = () => {
  const emitter = new EventEmitter();

  return {
    serverBridge: {
      ws: {} as BridgeServer['ws'],
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
    emitEvent: (event: unknown) => {
      emitter.emit('event', event);
    },
    emitDisconnect: () => {
      emitter.emit('disconnect');
    },
  };
};

const createReporter = (): Reporter => {
  const listeners = new Set<(event: ReportableEvent) => void>();

  return {
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
  };
};

const createMetroInstance = (
  overrides: Partial<MetroInstance> = {}
): MetroInstance => ({
  events: createReporter(),
  httpServer: {} as never,
  websocketEndpoints: {},
  waitUntilHealthy: vi.fn(async () => 'HTTP 200: packager-status:running'),
  prewarm: vi.fn(async () => false),
  dispose: vi.fn(async () => undefined),
  ...overrides,
});

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
    bundleStartTimeout: 60_000,
    crashDetectionInterval: 500,
    defaultRunner: 'ios',
    detectNativeCrashes: true,
    disableViewFlattening: false,
    entryPoint: 'index.js',
    forwardClientLogs: false,
    maxAppRestarts: 2,
    metroPort: 8081,
    platformReadyTimeout: 300_000,
    resetEnvironmentBetweenTestFiles: true,
    runners: [],
    unstable__enableMetroCache: false,
    unstable__skipAlreadyIncludedModules: false,
    webSocketPort: 3001,
    ...overrides,
  } as HarnessConfig);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPortAvailable.mockReset();
  mocks.isPortAvailable.mockResolvedValue(true);
});

afterEach(() => {
  delete (
    globalThis as typeof globalThis & {
      __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
    }
  ).__HARNESS_PLATFORM_RUNNER__;
});

describe('waitForAppReady', () => {
  it('delegates startup orchestration to bundler-metro and resolves readiness from the bridge', async () => {
    const { serverBridge, emitReady } = createBridgeServer();
    const metroInstance = createMetroInstance();
    const platformInstance = createPlatformRunner();
    const { appMonitor } = createAppMonitor();
    const crashSupervisor = createCrashSupervisor({
      appMonitor,
      platformRunner: platformInstance,
    });

    mocks.waitForMetroBackedAppReady.mockImplementationOnce(
      async (options: WaitForMetroBackedAppReadyOptions) => {
        options.onAttemptStart?.();
        const readyPromise = options.waitForReady(new AbortController().signal);
        emitReady();
        await readyPromise;
        options.onAttemptReset?.();
      }
    );

    await waitForAppReady({
      metroInstance,
      serverBridge,
      platformInstance,
      platformId: 'ios',
      bundleStartTimeout: 1_500,
      readyTimeout: 2_500,
      maxAppRestarts: 3,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
    });

    expect(mocks.waitForMetroBackedAppReady).toHaveBeenCalledWith(
      expect.objectContaining({
        metro: metroInstance,
        platformId: 'ios',
        bundleStartTimeout: 1_500,
        readyTimeout: 2_500,
        maxAppRestarts: 3,
        startAttempt: expect.any(Function),
        waitForReady: expect.any(Function),
        waitForCrash: expect.any(Function),
      })
    );
    expect(crashSupervisor.isReady()).toBe(true);

    await crashSupervisor.dispose();
  });

  it('passes launch options through the shared Metro startup helper', async () => {
    const { serverBridge } = createBridgeServer();
    const metroInstance = createMetroInstance();
    const restartApp = vi.fn(async () => undefined);
    const platformInstance = createPlatformRunner({ restartApp });
    const { appMonitor } = createAppMonitor();
    const crashSupervisor = createCrashSupervisor({
      appMonitor,
      platformRunner: platformInstance,
    });

    mocks.waitForMetroBackedAppReady.mockImplementationOnce(
      async (options: WaitForMetroBackedAppReadyOptions) => {
        await options.startAttempt();
      }
    );

    await waitForAppReady({
      metroInstance,
      serverBridge,
      platformInstance,
      platformId: 'ios',
      bundleStartTimeout: 1_500,
      readyTimeout: 2_500,
      maxAppRestarts: 3,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
      appLaunchOptions: {
        extras: {
          mode: 'startup',
        },
      },
    });

    expect(restartApp).toHaveBeenCalledWith({
      extras: {
        mode: 'startup',
      },
    });

    await crashSupervisor.dispose();
  });
});

describe('getHarness', () => {
  it('fails when the platform runner does not become ready within platformReadyTimeout', async () => {
    const { serverBridge } = createBridgeServer();
    const metroInstance = createMetroInstance();

    mocks.getBridgeServer.mockResolvedValue(serverBridge);
    mocks.getMetroInstance.mockResolvedValue(metroInstance);

    (
      globalThis as typeof globalThis & {
        __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
      }
    ).__HARNESS_PLATFORM_RUNNER__ = vi.fn(
      async () =>
        await new Promise((_, reject) => {
          setTimeout(() => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          }, 20);
        })
    );

    const platform: HarnessPlatform = {
      config: {},
      getResourceLockKey: () => 'ios:test-platform-ready-timeout',
      name: 'ios',
      platformId: 'ios',
      runner: `data:text/javascript,${encodeURIComponent(
        'export default (...args) => globalThis.__HARNESS_PLATFORM_RUNNER__(...args);'
      )}`,
    };

    await expect(
      getHarness(
        createHarnessConfig({
          platformReadyTimeout: 10,
        }),
        platform,
        '/tmp/project'
      )
    ).rejects.toBeInstanceOf(PlatformReadyTimeoutError);
  });

  it('passes a platform init signal to the runner factory', async () => {
    const { serverBridge } = createBridgeServer();
    const appMonitor = createAppMonitor();
    const platformInstance = createPlatformRunner({
      createAppMonitor: () => appMonitor.appMonitor,
    });
    const metroInstance = createMetroInstance();

    mocks.getBridgeServer.mockResolvedValue(serverBridge);
    mocks.getMetroInstance.mockResolvedValue(metroInstance);

    const runner = vi.fn(async () => platformInstance);
    (
      globalThis as typeof globalThis & {
        __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
      }
    ).__HARNESS_PLATFORM_RUNNER__ = runner;

    const platform: HarnessPlatform = {
      config: {},
      getResourceLockKey: () => 'ios:test-platform-init-signal',
      name: 'ios',
      platformId: 'ios',
      runner: `data:text/javascript,${encodeURIComponent(
        'export default (...args) => globalThis.__HARNESS_PLATFORM_RUNNER__(...args);'
      )}`,
    };

    const harness = await getHarness(
      createHarnessConfig(),
      platform,
      '/tmp/project'
    );

    expect(runner).toHaveBeenCalledWith(
      platform.config,
      expect.objectContaining({
        metroPort: 8081,
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );

    await harness.dispose();
  });

  it('resolves and exposes a fallback Metro port before platform init', async () => {
    const { serverBridge } = createBridgeServer();
    const appMonitor = createAppMonitor();
    const platformInstance = createPlatformRunner({
      createAppMonitor: () => appMonitor.appMonitor,
    });
    const metroInstance = createMetroInstance();

    mocks.getBridgeServer.mockResolvedValue(serverBridge);
    mocks.getMetroInstance.mockResolvedValue(metroInstance);
    mocks.isPortAvailable
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const runner = vi.fn(async () => platformInstance);
    (
      globalThis as typeof globalThis & {
        __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
      }
    ).__HARNESS_PLATFORM_RUNNER__ = runner;

    const platform: HarnessPlatform = {
      config: {},
      getResourceLockKey: () => 'android:emulator:Pixel_8_API_35',
      name: 'android',
      platformId: 'android',
      runner: `data:text/javascript,${encodeURIComponent(
        'export default (...args) => globalThis.__HARNESS_PLATFORM_RUNNER__(...args);'
      )}`,
    };

    const harness = await getHarness(
      createHarnessConfig(),
      platform,
      '/tmp/project'
    );

    expect(harness.config.metroPort).toBe(8082);
    expect(mocks.getMetroInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        harnessConfig: expect.objectContaining({
          metroPort: 8082,
        }),
      }),
      expect.any(AbortSignal)
    );
    expect(runner).toHaveBeenCalledWith(
      platform.config,
      expect.objectContaining({
        metroPort: 8082,
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
    expect(mocks.logMetroPortFallback).toHaveBeenCalledWith(8081, 8082);

    await harness.dispose();
  });

  it('fails when no Metro port is available in the retry window', async () => {
    mocks.isPortAvailable.mockResolvedValue(false);

    const platform: HarnessPlatform = {
      config: {},
      getResourceLockKey: () => 'android:emulator:Pixel_8_API_35',
      name: 'android',
      platformId: 'android',
      runner: 'data:text/javascript,export default async () => ({})',
    };

    await expect(
      getHarness(createHarnessConfig(), platform, '/tmp/project')
    ).rejects.toBeInstanceOf(MetroPortRangeExhaustedError);

    expect(mocks.getBridgeServer).not.toHaveBeenCalled();
    expect(mocks.getMetroInstance).not.toHaveBeenCalled();
  });

  it('falls back to a default resource lock key for platforms without getResourceLockKey', async () => {
    const { serverBridge } = createBridgeServer();
    const appMonitor = createAppMonitor();
    const platformInstance = createPlatformRunner({
      createAppMonitor: () => appMonitor.appMonitor,
    });
    const metroInstance = createMetroInstance();

    mocks.getBridgeServer.mockResolvedValue(serverBridge);
    mocks.getMetroInstance.mockResolvedValue(metroInstance);

    (
      globalThis as typeof globalThis & {
        __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
      }
    ).__HARNESS_PLATFORM_RUNNER__ = vi.fn(async () => platformInstance);

    const platform: HarnessPlatform = {
      config: {},
      name: 'legacy-ios',
      platformId: 'ios',
      runner: `data:text/javascript,${encodeURIComponent(
        'export default (...args) => globalThis.__HARNESS_PLATFORM_RUNNER__(...args);'
      )}`,
    };

    const harness = await getHarness(
      createHarnessConfig(),
      platform,
      '/tmp/project'
    );

    await harness.dispose();
  });

  it('routes ensureAppReady through the shared Metro startup helper', async () => {
    const { serverBridge, emitReady } = createBridgeServer();
    const appMonitor = createAppMonitor();
    const restartApp = vi.fn(async () => undefined);
    const platformInstance = createPlatformRunner({
      restartApp,
      createAppMonitor: () => appMonitor.appMonitor,
    });
    const metroInstance = createMetroInstance();

    mocks.getBridgeServer.mockResolvedValue(serverBridge);
    mocks.getMetroInstance.mockResolvedValue(metroInstance);
    mocks.waitForMetroBackedAppReady.mockImplementationOnce(
      async (options: WaitForMetroBackedAppReadyOptions) => {
        await options.startAttempt();
        const readyPromise = options.waitForReady(new AbortController().signal);
        emitReady();
        await readyPromise;
      }
    );

    (
      globalThis as typeof globalThis & {
        __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
      }
    ).__HARNESS_PLATFORM_RUNNER__ = vi.fn(async () => platformInstance);

    const platform: HarnessPlatform = {
      config: {
        appLaunchOptions: {
          extras: {
            source: 'ensure-ready',
          },
        },
      },
      name: 'ios',
      platformId: 'ios',
      runner: `data:text/javascript,${encodeURIComponent(
        'export default (...args) => globalThis.__HARNESS_PLATFORM_RUNNER__(...args);'
      )}`,
      getResourceLockKey: () => 'ios:simulator:iPhone 17 Pro:26.2',
    };

    const harness = await getHarness(
      createHarnessConfig({
        bridgeTimeout: 1,
      }),
      platform,
      '/tmp/project'
    );

    await harness.ensureAppReady('/tmp/example.harness.ts');

    expect(mocks.waitForMetroBackedAppReady).toHaveBeenCalledTimes(1);
    expect(restartApp).toHaveBeenCalledWith({
      extras: {
        source: 'ensure-ready',
      },
    });

    await harness.dispose();
  });

  it('routes restart(testFilePath) through the shared Metro startup helper', async () => {
    const { serverBridge, emitReady } = createBridgeServer();
    const appMonitor = createAppMonitor();
    const restartApp = vi.fn(async () => undefined);
    const stopApp = vi.fn(async () => undefined);
    const platformInstance = createPlatformRunner({
      restartApp,
      stopApp,
      isAppRunning: vi.fn(async () => false),
      createAppMonitor: () => appMonitor.appMonitor,
    });
    const metroInstance = createMetroInstance();

    mocks.getBridgeServer.mockResolvedValue(serverBridge);
    mocks.getMetroInstance.mockResolvedValue(metroInstance);
    mocks.waitForMetroBackedAppReady.mockImplementationOnce(
      async (options: WaitForMetroBackedAppReadyOptions) => {
        await options.startAttempt();
        const readyPromise = options.waitForReady(new AbortController().signal);
        emitReady();
        await readyPromise;
      }
    );

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
      getResourceLockKey: () => 'ios:simulator:iPhone 17 Pro:26.2',
    };

    const harness = await getHarness(
      createHarnessConfig(),
      platform,
      '/tmp/project'
    );

    expect(mocks.getBridgeServer).toHaveBeenCalledWith(
      expect.objectContaining({
        noServer: true,
      })
    );
    expect(mocks.getMetroInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        websocketEndpoints: {
          [HARNESS_BRIDGE_PATH]: serverBridge.ws,
        },
      }),
      expect.any(AbortSignal)
    );
    await harness.restart('/tmp/restart.harness.ts');

    expect(stopApp).toHaveBeenCalledTimes(1);
    expect(mocks.waitForMetroBackedAppReady).toHaveBeenCalledTimes(1);
    expect(restartApp).toHaveBeenCalledWith({
      extras: {
        source: 'restart',
      },
    });

    await harness.dispose();
  });
});

describe('plugins', () => {
  it('invokes lifecycle and runtime plugin handlers for configured plugins', async () => {
    const { serverBridge, emitReady, emitEvent, emitDisconnect } =
      createBridgeServer();
    const appMonitor = createAppMonitor();
    const platformInstance = createPlatformRunner({
      createAppMonitor: () => appMonitor.appMonitor,
    });
    const observedHooks: string[] = [];

    mocks.getBridgeServer.mockResolvedValue(serverBridge);
    const metroInstance = createMetroInstance();
    mocks.getMetroInstance.mockResolvedValue(metroInstance);

    (
      globalThis as typeof globalThis & {
        __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
      }
    ).__HARNESS_PLATFORM_RUNNER__ = vi.fn(async () => platformInstance);

    const plugin = definePlugin<
      {
        creationCount: number;
      },
      HarnessConfig,
      HarnessPlatform
    >({
      name: 'test-plugin',
      createState: () => ({
        creationCount: 0,
      }),
      hooks: {
        harness: {
          beforeCreation: (ctx) => {
            ctx.state.creationCount += 1;
            observedHooks.push(
              `beforeCreation:${ctx.platform.platformId}:${
                ctx.appLaunchOptions == null
                  ? 'no-launch-options'
                  : 'launch-options'
              }`
            );
          },
          beforeRun: (ctx) => {
            observedHooks.push(
              `beforeRun:${ctx.platform.platformId}:${
                ctx.appLaunchOptions == null
                  ? 'no-launch-options'
                  : 'launch-options'
              }`
            );
          },
          afterRun: (ctx) => {
            observedHooks.push(
              `afterRun:${ctx.state.creationCount}:${ctx.reason}`
            );
          },
          beforeDispose: (ctx) => {
            observedHooks.push(
              `beforeDispose:${ctx.state.creationCount}:${ctx.reason}`
            );
          },
        },
        runtime: {
          ready: (ctx) => {
            observedHooks.push(
              `runtime.ready:${ctx.runId}:${ctx.device.platform}`
            );
          },
          disconnected: (ctx) => {
            observedHooks.push(`runtime.disconnected:${ctx.reason}`);
          },
        },
        collection: {
          started: (ctx) => {
            observedHooks.push(`collection.started:${ctx.file}`);
          },
        },
      },
    });

    const platform: HarnessPlatform = {
      config: {
        appLaunchOptions: {
          environment: {
            MODE: 'test',
          },
        },
      },
      name: 'ios',
      platformId: 'ios',
      runner: `data:text/javascript,${encodeURIComponent(
        'export default (...args) => globalThis.__HARNESS_PLATFORM_RUNNER__(...args);'
      )}`,
      getResourceLockKey: () => 'ios:simulator:iPhone 17 Pro:26.2',
    };

    const harness = await getHarness(
      createHarnessConfig({
        plugins: [plugin],
      }),
      platform,
      '/tmp/project'
    );

    harness.setRunState({
      runId: 'run-1',
      startTime: Date.now(),
      testFiles: ['example.harness.ts'],
      watchMode: false,
      coverageEnabled: false,
      summary: {
        passed: 1,
        failed: 0,
        skipped: 0,
        todo: 0,
      },
      status: 'passed',
    });

    emitReady();
    emitEvent({
      type: 'collection-started',
      file: 'example.harness.ts',
    });
    emitDisconnect();

    await harness.dispose();

    expect(observedHooks).toEqual([
      'beforeCreation:ios:launch-options',
      'beforeRun:ios:launch-options',
      'runtime.ready:run-1:ios',
      'collection.started:example.harness.ts',
      'runtime.disconnected:bridge-disconnected',
      'afterRun:1:normal',
      'beforeDispose:1:normal',
    ]);
  });

  it('waits in queue before starting Metro and releases the lock on dispose', async () => {
    const resourceKey = 'ios:simulator:iPhone 17 Pro:26.2';
    const firstPlatformRunner = createPlatformRunner();
    const secondPlatformRunner = createPlatformRunner();
    const secondAppMonitor = createAppMonitor();
    const firstMetroInstance = createMetroInstance();
    const secondMetroInstance = createMetroInstance();
    const firstBridge = createBridgeServer();
    const secondBridge = createBridgeServer();

    mocks.getBridgeServer
      .mockResolvedValueOnce(firstBridge.serverBridge)
      .mockResolvedValueOnce(secondBridge.serverBridge);
    mocks.getMetroInstance
      .mockResolvedValueOnce(firstMetroInstance)
      .mockResolvedValueOnce(secondMetroInstance);

    let invocationCount = 0;
    (
      globalThis as typeof globalThis & {
        __HARNESS_PLATFORM_RUNNER__?: (...args: unknown[]) => Promise<unknown>;
      }
    ).__HARNESS_PLATFORM_RUNNER__ = vi.fn(async () => {
      invocationCount += 1;
      return invocationCount === 1
        ? firstPlatformRunner
        : createPlatformRunner({
            createAppMonitor: () => secondAppMonitor.appMonitor,
            dispose: secondPlatformRunner.dispose,
          });
    });

    const platform: HarnessPlatform = {
      config: {},
      name: 'ios',
      platformId: 'ios',
      runner: `data:text/javascript,${encodeURIComponent(
        'export default (...args) => globalThis.__HARNESS_PLATFORM_RUNNER__(...args);'
      )}`,
      getResourceLockKey: () => resourceKey,
    };

    const firstHarness = await getHarness(
      createHarnessConfig(),
      platform,
      '/tmp/project'
    );

    const secondHarnessPromise = getHarness(
      createHarnessConfig(),
      platform,
      '/tmp/project'
    );

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(mocks.logRunnerWaitingInQueue).toHaveBeenCalledWith(platform);
    expect(mocks.logRunnerStarting).not.toHaveBeenCalled();
    expect(mocks.getMetroInstance).toHaveBeenCalledTimes(1);

    await firstHarness.dispose();
    const secondHarness = await secondHarnessPromise;

    expect(mocks.logRunnerStarting).toHaveBeenCalledWith(platform);
    expect(mocks.getMetroInstance).toHaveBeenCalledTimes(2);

    await secondHarness.dispose();
  });
});

describe('StartupStallError', () => {
  it('includes the configured timeout and attempt count', () => {
    expect(new StartupStallError(1_500, 4).message).toBe(
      'The app did not request its Metro bundle after 4 launch attempts within 1500ms. Last Metro status: unknown.'
    );
  });
});
