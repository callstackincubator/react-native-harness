import { describe, expect, it, vi } from 'vitest';
import type { OwnedProcess, Subprocess } from '@react-native-harness/tools';
import { createIosAppSession } from '../app-session.js';

const createPendingLaunchProcess = (): OwnedProcess => {
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
  const subprocess = Object.assign(pending, {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await pending;
        return { done: true, value: undefined };
      },
    }),
    nodeChildProcess: Promise.resolve(child),
  }) as unknown as Subprocess;
  return { subprocess, dispose: async () => { child.kill(); } };
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

  it('resolves dispose() without waiting out the pending poll delay', async () => {
    vi.useFakeTimers();

    try {
      const launchProcess = createPendingLaunchProcess();
      const isAppRunning = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const stopApp = vi.fn(async () => undefined);

      const sessionPromise = createIosAppSession({
        launch: () => launchProcess,
        stopApp,
        isAppRunning,
      });

      await vi.advanceTimersByTimeAsync(100);
      const session = await sessionPromise;

      // Let the poll loop enter its 1s wait before tearing down.
      await vi.advanceTimersByTimeAsync(0);

      // Regression: dispose() used to await the poll task directly, which
      // was blocked on an uncancelled 1s sleep(). With fake timers and no
      // advanceTimersByTimeAsync call left below, this await only resolves
      // if dispose() itself resolves the pending poll delay instead of
      // waiting for the underlying timer to fire.
      await session.dispose();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not dispose the session before explicit disposal', async () => {
    vi.useFakeTimers();

    try {
      const launchProcess = createPendingLaunchProcess();
      const isAppRunning = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const stopApp = vi.fn(async () => undefined);

      const sessionPromise = createIosAppSession({
        launch: () => launchProcess,
        stopApp,
        isAppRunning,
      });

      await vi.advanceTimersByTimeAsync(100);
      const session = await sessionPromise;

      await vi.advanceTimersByTimeAsync(1000);

      await expect(session.getState()).resolves.toMatchObject({
        status: 'running',
      });
      expect(stopApp).not.toHaveBeenCalled();
      await session.dispose();
      expect(stopApp).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remains running until explicitly disposed', async () => {
    vi.useFakeTimers();

    try {
      const launchProcess = createPendingLaunchProcess();
      const isAppRunning = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const stopApp = vi.fn(async () => undefined);
      const sessionPromise = createIosAppSession({
        launch: () => launchProcess,
        stopApp,
        isAppRunning,
      });

      await vi.advanceTimersByTimeAsync(100);
      const session = await sessionPromise;
      await vi.advanceTimersByTimeAsync(1000);

      await expect(session.getState()).resolves.toMatchObject({
        status: 'running',
      });
      expect(stopApp).not.toHaveBeenCalled();
      await session.dispose();
      expect(stopApp).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
