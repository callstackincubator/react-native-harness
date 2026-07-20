import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminate } from '../terminate.js';
import type { Subprocess } from 'nano-spawn';

type MockChildProcess = EventEmitter & {
  exitCode: number | null;
  signalCode: string | null;
  kill: ReturnType<typeof vi.fn>;
};

const createMockChildProcess = (options?: {
  exitOnKill?: 'SIGTERM' | 'SIGKILL';
}): MockChildProcess => {
  const childProcess = new EventEmitter() as MockChildProcess;
  childProcess.exitCode = null;
  childProcess.signalCode = null;
  childProcess.kill = vi.fn((signal: string) => {
    if (options?.exitOnKill === signal) {
      childProcess.signalCode = signal;
      childProcess.emit('close');
    }
    return true;
  });
  return childProcess;
};

const createMockSubprocess = (childProcess: MockChildProcess): Subprocess =>
  ({
    nodeChildProcess: Promise.resolve(childProcess),
  }) as unknown as Subprocess;

afterEach(() => {
  vi.useRealTimers();
});

describe('terminate', () => {
  it('resolves immediately when the process already exited', async () => {
    const childProcess = createMockChildProcess();
    childProcess.exitCode = 0;

    await terminate(createMockSubprocess(childProcess), { forceAfterMs: 1_000 });

    expect(childProcess.kill).toHaveBeenCalledTimes(1);
    expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('sends SIGTERM and resolves once the process exits gracefully', async () => {
    const childProcess = createMockChildProcess({ exitOnKill: 'SIGTERM' });

    await terminate(createMockSubprocess(childProcess), { forceAfterMs: 1_000 });

    expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(childProcess.kill).toHaveBeenCalledTimes(1);
  });

  it('escalates to SIGKILL if the process does not exit before forceAfterMs', async () => {
    vi.useFakeTimers();
    const childProcess = createMockChildProcess({ exitOnKill: 'SIGKILL' });

    const done = terminate(createMockSubprocess(childProcess), {
      forceAfterMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await done;

    expect(childProcess.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(childProcess.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('clears the force-kill timer once the process exits gracefully', async () => {
    vi.useFakeTimers();
    const childProcess = createMockChildProcess({ exitOnKill: 'SIGTERM' });

    await terminate(createMockSubprocess(childProcess), { forceAfterMs: 1_000 });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing if resolving nodeChildProcess rejects', async () => {
    const subprocess = {
      nodeChildProcess: Promise.reject(new Error('spawn failed')),
    } as unknown as Subprocess;

    await expect(
      terminate(subprocess, { forceAfterMs: 1_000 })
    ).resolves.toBeUndefined();
  });
});
