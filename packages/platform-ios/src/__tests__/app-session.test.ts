import { describe, expect, it, vi } from 'vitest';
import type { Subprocess } from '@react-native-harness/tools';
import { createIosAppSession } from '../app-session.js';

const createPendingLaunchProcess = (): Subprocess => {
  let resolveLaunch!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveLaunch = resolve;
  });
  const child = {
    kill: vi.fn(() => {
      resolveLaunch();
      return true;
    }),
  };
  return Object.assign(pending, {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await pending;
        return { done: true, value: undefined };
      },
    }),
    nodeChildProcess: Promise.resolve(child),
  }) as unknown as Subprocess;
};

describe('createIosAppSession', () => {
  it('does not report an exit before the app has been observed running', async () => {
    vi.useFakeTimers();

    try {
      const launchProcess = createPendingLaunchProcess();
      const isAppRunning = vi
        .fn<() => Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);

      const sessionPromise = createIosAppSession({
        launch: () => launchProcess,
        stopApp: vi.fn(async () => undefined),
        isAppRunning,
      });

      await vi.advanceTimersByTimeAsync(100);
      const session = await sessionPromise;
      const listener = vi.fn();
      session.addListener(listener);

      await vi.advanceTimersByTimeAsync(1000);

      await expect(session.getState()).resolves.toMatchObject({
        status: 'running',
      });
      expect(listener).not.toHaveBeenCalled();

      const disposePromise = session.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      await disposePromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes the session when the session-lifetime signal aborts', async () => {
    vi.useFakeTimers();

    try {
      const launchProcess = createPendingLaunchProcess();
      const isAppRunning = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const stopApp = vi.fn(async () => undefined);
      const controller = new AbortController();

      const sessionPromise = createIosAppSession({
        launch: () => launchProcess,
        stopApp,
        isAppRunning,
        signal: controller.signal,
      });

      await vi.advanceTimersByTimeAsync(100);
      const session = await sessionPromise;

      controller.abort();
      await vi.advanceTimersByTimeAsync(1000);

      await expect(session.getState()).resolves.toMatchObject({
        status: 'disposed',
      });
      expect(stopApp).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes immediately when created with an already-aborted signal', async () => {
    vi.useFakeTimers();

    try {
      const launchProcess = createPendingLaunchProcess();
      const isAppRunning = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const stopApp = vi.fn(async () => undefined);
      const controller = new AbortController();
      controller.abort();

      const sessionPromise = createIosAppSession({
        launch: () => launchProcess,
        stopApp,
        isAppRunning,
        signal: controller.signal,
      });

      await vi.advanceTimersByTimeAsync(100);
      const session = await sessionPromise;
      await vi.advanceTimersByTimeAsync(1000);

      await expect(session.getState()).resolves.toMatchObject({
        status: 'disposed',
      });
      expect(stopApp).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
