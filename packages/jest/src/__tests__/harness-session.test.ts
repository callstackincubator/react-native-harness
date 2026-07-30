import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConnection } from '@react-native-harness/bridge/server';
import {
  getSignalExitCodeForRunState,
  waitForBridgeDisconnectOrTimeout,
  waitForNextConnected,
  waitForStartupCrash,
  withPlatformReadyTimeout,
  type HarnessRunState,
} from '../harness-session.js';
import type { CrashMonitor } from '../crash-monitor.js';
import { PlatformReadyTimeoutError } from '../errors.js';

const createConnection = (): AppConnection => ({
  device: {
    platform: 'ios',
    manufacturer: 'Apple',
    model: 'iPhone',
    osVersion: '18.0',
  },
  runTests: vi.fn(),
  resetEnvironment: vi.fn(),
});

const createBridge = (connection: AppConnection | null) => {
  let currentConnection = connection;
  let disconnectedListener: (() => void) | null = null;

  return {
    get connection() {
      return currentConnection;
    },
    on: vi.fn((event: 'disconnected', listener: () => void) => {
      if (event === 'disconnected') {
        disconnectedListener = listener;
      }
    }),
    off: vi.fn((event: 'disconnected', listener: () => void) => {
      if (event === 'disconnected' && disconnectedListener === listener) {
        disconnectedListener = null;
      }
    }),
    disconnect: () => {
      currentConnection = null;
      disconnectedListener?.();
    },
  };
};

describe('waitForBridgeDisconnectOrTimeout', () => {
  it('returns true when the bridge disconnects before the timeout', async () => {
    const connection = createConnection();
    const bridge = createBridge(connection);

    const waitPromise = waitForBridgeDisconnectOrTimeout({
      bridge,
      connection,
      timeoutMs: 50,
    });

    bridge.disconnect();

    await expect(waitPromise).resolves.toBe(true);
  });

  it('returns false when the bridge stays connected through the timeout', async () => {
    const connection = createConnection();
    const bridge = createBridge(connection);

    await expect(
      waitForBridgeDisconnectOrTimeout({
        bridge,
        connection,
        timeoutMs: 10,
      }),
    ).resolves.toBe(false);
  });
});

describe('waitForNextConnected', () => {
  const createConnectableBridge = () => {
    let listener: (() => void) | null = null;
    const bridge: Pick<
      import('@react-native-harness/bridge/server').HarnessBridge,
      'on' | 'off'
    > = {
      on: vi.fn((event, l) => {
        if (event === 'connected') listener = l as () => void;
      }),
      off: vi.fn((event, l) => {
        if (event === 'connected' && listener === l) listener = null;
      }),
    };
    return { bridge, emitConnected: () => listener?.() };
  };

  it('resolves when the bridge emits a connected event', async () => {
    const { bridge, emitConnected } = createConnectableBridge();
    const controller = new AbortController();

    const waitPromise = waitForNextConnected({ bridge, signal: controller.signal });
    emitConnected();

    await expect(waitPromise).resolves.toBeUndefined();
  });

  it('rejects when the signal aborts before a connected event', async () => {
    const { bridge } = createConnectableBridge();
    const controller = new AbortController();

    const waitPromise = waitForNextConnected({ bridge, signal: controller.signal });
    controller.abort(new DOMException('Aborted', 'AbortError'));

    await expect(waitPromise).rejects.toThrow('Aborted');
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { bridge } = createConnectableBridge();
    const controller = new AbortController();
    controller.abort(new DOMException('Aborted', 'AbortError'));

    await expect(
      waitForNextConnected({ bridge, signal: controller.signal }),
    ).rejects.toThrow('Aborted');
  });

  it('unsubscribes the connected listener once settled', async () => {
    const { bridge, emitConnected } = createConnectableBridge();
    const controller = new AbortController();

    const waitPromise = waitForNextConnected({ bridge, signal: controller.signal });
    emitConnected();
    await waitPromise;

    expect(bridge.off).toHaveBeenCalledOnce();
  });
});

describe('waitForStartupCrash', () => {
  it('does not install a startup crash watch when native crash detection is disabled', async () => {
    const watch = vi.fn();
    const crashMonitor = {
      watch,
    } as unknown as CrashMonitor;
    const controller = new AbortController();
    const waitPromise = waitForStartupCrash({
      crashMonitor,
      detectNativeCrashes: false,
      testFilePath: '/test.harness.ts',
      signal: controller.signal,
    });

    controller.abort(new DOMException('Aborted', 'AbortError'));

    await expect(waitPromise).rejects.toThrow('Aborted');
    expect(watch).not.toHaveBeenCalled();
  });

  it('removes its abort listener on the session signal once the crash watch wins', async () => {
    let rejectWatch!: (error: unknown) => void;
    const cancel = vi.fn();
    const watch = vi.fn(() => ({
      promise: new Promise<never>((_, reject) => {
        rejectWatch = reject;
      }),
      cancel,
    }));
    const crashMonitor = { watch } as unknown as CrashMonitor;
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const waitPromise = waitForStartupCrash({
      crashMonitor,
      detectNativeCrashes: true,
      testFilePath: '/test.harness.ts',
      signal: controller.signal,
    });

    // The crash watch wins the race, not the session signal.
    rejectWatch(new Error('native crash detected'));

    await expect(waitPromise).rejects.toThrow('native crash detected');
    expect(cancel).toHaveBeenCalledTimes(1);

    // Regression: forgetting to cancel the losing waitForAbort() left its
    // listener attached to this session-lifetime signal for the rest of
    // the session — one leaked listener per test file.
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('withPlatformReadyTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the real session signal to work, unmodified by the timeout', async () => {
    const controller = new AbortController();
    const work = vi.fn(async (signal: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      return 'ready';
    });

    await expect(
      withPlatformReadyTimeout({
        timeout: 1_000,
        signal: controller.signal,
        work,
      }),
    ).resolves.toBe('ready');
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('throws PlatformReadyTimeoutError on timeout without aborting the session signal', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    // Never resolves within the test; simulates a hung platform init.
    const work = () => new Promise<void>(() => undefined);

    const resultPromise = withPlatformReadyTimeout({
      timeout: 1_000,
      signal: controller.signal,
      work,
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(resultPromise).rejects.toBeInstanceOf(PlatformReadyTimeoutError);
    expect(controller.signal.aborted).toBe(false);
  });

  it('propagates a genuine abort from the session signal as-is', async () => {
    const controller = new AbortController();
    const abortReason = new DOMException('Aborted', 'AbortError');
    const work = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });

    const resultPromise = withPlatformReadyTimeout({
      timeout: 1_000,
      signal: controller.signal,
      work,
    });

    controller.abort(abortReason);

    await expect(resultPromise).rejects.toBe(abortReason);
  });
});

describe('getSignalExitCodeForRunState', () => {
  const createRunState = (
    overrides: Partial<HarnessRunState> = {}
  ): HarnessRunState => ({
    completed: true,
    coverageEnabled: false,
    runId: 'run-1',
    startTime: 0,
    status: 'passed',
    summary: {
      failed: 0,
      passed: 1,
      skipped: 0,
      todo: 0,
    },
    testFiles: ['test.harness.ts'],
    watchMode: false,
    ...overrides,
  });

  it('preserves a successful exit after a completed passing run', () => {
    expect(getSignalExitCodeForRunState(createRunState())).toBe(0);
  });

  it('fails when the run has not completed yet', () => {
    expect(
      getSignalExitCodeForRunState(createRunState({ completed: false }))
    ).toBe(1);
  });

  it('fails when the completed run has failures', () => {
    expect(
      getSignalExitCodeForRunState(
        createRunState({
          status: 'failed',
          summary: {
            failed: 1,
            passed: 0,
            skipped: 0,
            todo: 0,
          },
        })
      )
    ).toBe(1);
  });

  it('fails when no run state is available', () => {
    expect(getSignalExitCodeForRunState(null)).toBe(1);
  });
});
