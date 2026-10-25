import { describe, expect, it, vi } from 'vitest';
import type { OwnedProcess } from '@react-native-harness/tools';
import { createVegaAppSession } from '../app-session.js';

const fakeOwnedProcess = (lines: string[] = []): OwnedProcess => {
  const subprocess = Object.assign(Promise.resolve({ stdout: '', stderr: '' }), {
    [Symbol.asyncIterator]: async function* () {
      yield* lines;
    },
  });

  return {
    subprocess: subprocess as unknown as OwnedProcess['subprocess'],
    dispose: vi.fn().mockResolvedValue(undefined),
  };
};

const createOptions = () => ({
  launchApp: vi.fn().mockResolvedValue(undefined),
  terminateApp: vi.fn().mockResolvedValue(undefined),
  getAppRunState: vi.fn().mockResolvedValue('running'),
  startLogStream: vi.fn(() => fakeOwnedProcess()),
  stopLogStream: vi.fn().mockResolvedValue(undefined),
});

describe('createVegaAppSession', () => {
  it('emits app_exited and reports the exited state once the app is gone', async () => {
    vi.useFakeTimers();
    try {
      const options = createOptions();
      options.getAppRunState.mockResolvedValue('stopped');
      const listener = vi.fn();

      const session = await createVegaAppSession({ ...options, startGraceMs: 0 });
      session.addListener(listener);

      // Two confirming polls are needed, one poll interval apart: the first
      // runs immediately, the second one interval later.
      await vi.advanceTimersByTimeAsync(500);
      expect(listener).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500 + 10);
      expect(listener).toHaveBeenCalledWith({ type: 'app_exited' });
      expect((await session.getState()).status).toBe('exited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores failed probes and needs consecutive stopped answers before declaring an exit', async () => {
    vi.useFakeTimers();
    try {
      const options = createOptions();
      options.getAppRunState
        .mockResolvedValueOnce('running')
        .mockResolvedValueOnce('unknown')
        .mockResolvedValueOnce('stopped')
        .mockResolvedValueOnce('unknown')
        .mockResolvedValueOnce('stopped')
        .mockResolvedValue('stopped');

      const session = await createVegaAppSession({ ...options, startGraceMs: 0 });

      // running, unknown, stopped, unknown: still alive after four polls.
      await vi.advanceTimersByTimeAsync(3 * 1000 + 10);
      expect((await session.getState()).status).toBe('running');

      // stopped, stopped: now confirmed.
      await vi.advanceTimersByTimeAsync(2 * 1000 + 10);
      expect((await session.getState()).status).toBe('exited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling during the start grace window', async () => {
    vi.useFakeTimers();
    try {
      const options = createOptions();
      options.getAppRunState.mockResolvedValue('stopped');

      const session = await createVegaAppSession({
        ...options,
        startGraceMs: 5000,
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect((await session.getState()).status).toBe('running');

      await vi.advanceTimersByTimeAsync(3000);
      expect((await session.getState()).status).toBe('exited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the log stream and terminates the app on dispose', async () => {
    const options = createOptions();
    const logStream = fakeOwnedProcess();
    options.startLogStream.mockReturnValue(logStream);

    const session = await createVegaAppSession(options);
    await session.dispose();

    expect(logStream.dispose).toHaveBeenCalledOnce();
    expect(options.stopLogStream).toHaveBeenCalledOnce();
    expect(options.terminateApp).toHaveBeenCalledOnce();
    expect((await session.getState()).status).toBe('disposed');
  });

  it('cleans up the log stream when the launch fails', async () => {
    const options = createOptions();
    const logStream = fakeOwnedProcess();
    options.startLogStream.mockReturnValue(logStream);
    options.launchApp.mockRejectedValue(new Error('launch failed'));

    await expect(createVegaAppSession(options)).rejects.toThrow('launch failed');
    expect(logStream.dispose).toHaveBeenCalledOnce();
    expect(options.stopLogStream).toHaveBeenCalledOnce();
  });
});
