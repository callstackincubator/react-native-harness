import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { waitForAppReady } from '../harness.js';
import type { BridgeServer } from '@react-native-harness/bridge/server';
import type {
  AppMonitor,
  AppMonitorListener,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import { createCrashSupervisor } from '../crash-supervisor.js';

const createBridgeServer = () => {
  const emitter = new EventEmitter();

  return {
    serverBridge: {
      on: emitter.on.bind(emitter),
      once: emitter.once.bind(emitter),
      off: emitter.off.bind(emitter),
    } as unknown as BridgeServer,
    emitReady: () => {
      emitter.emit('ready');
    },
  };
};

const createAppMonitor = (): AppMonitor => {
  const listeners = new Set<AppMonitorListener>();

  return {
    start: async () => undefined,
    stop: async () => undefined,
    dispose: async () => undefined,
    addListener: (listener) => {
      listeners.add(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
    },
  };
};

const createPlatformRunner = (
  restartApp: HarnessPlatformRunner['restartApp']
): HarnessPlatformRunner => ({
  startApp: async () => undefined,
  restartApp,
  stopApp: async () => undefined,
  dispose: async () => undefined,
  isAppRunning: async () => true,
  createAppMonitor: createAppMonitor,
});

describe('waitForAppReady', () => {
  it('passes launch options to the initial launch', async () => {
    const { serverBridge, emitReady } = createBridgeServer();
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const platformInstance = createPlatformRunner(restartApp);
    const crashSupervisor = createCrashSupervisor({
      appMonitor: createAppMonitor(),
      platformRunner: platformInstance,
    });

    const promise = waitForAppReady({
      serverBridge,
      platformInstance,
      bridgeTimeout: 5000,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
      appLaunchOptions: {
        extras: {
          mode: 'startup',
        },
      },
    });

    await Promise.resolve();
    expect(restartApp).toHaveBeenCalledWith({
      extras: {
        mode: 'startup',
      },
    });

    emitReady();
    await promise;
    await crashSupervisor.dispose();
  });

  it('does not retry launch when the app never becomes ready', async () => {
    vi.useFakeTimers();

    const { serverBridge } = createBridgeServer();
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const platformInstance = createPlatformRunner(restartApp);
    const crashSupervisor = createCrashSupervisor({
      appMonitor: createAppMonitor(),
      platformRunner: platformInstance,
    });

    const promise = waitForAppReady({
      serverBridge,
      platformInstance,
      bridgeTimeout: 1000,
      testFilePath: '/tmp/test.harness.ts',
      crashSupervisor,
      appLaunchOptions: {
        extras: {
          mode: 'startup',
        },
      },
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(restartApp).toHaveBeenCalledTimes(1);
    expect(restartApp).toHaveBeenCalledWith({
      extras: {
        mode: 'startup',
      },
    });

    await crashSupervisor.dispose();
    vi.useRealTimers();
  });
});
