import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockNanoSpawn = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('nano-spawn', () => {
  class MockSubprocessError extends Error {
    override name = 'SubprocessError';
  }

  return {
    default: mockNanoSpawn.spawn,
    SubprocessError: MockSubprocessError,
  };
});

import { spawn } from '../spawn.js';

type MockChildProcess = EventEmitter & {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
};

const createMockChildProcess = (options?: {
  exitOnKill?: NodeJS.Signals;
}): MockChildProcess => {
  const childProcess = new EventEmitter() as MockChildProcess;
  childProcess.exitCode = null;
  childProcess.signalCode = null;
  childProcess.kill = vi.fn((signal?: NodeJS.Signals) => {
    if (signal === 'SIGTERM' && options?.exitOnKill === 'SIGTERM') {
      childProcess.exitCode = 0;
      childProcess.emit('close');
      return true;
    }

    if (signal === 'SIGKILL' || options?.exitOnKill === signal) {
      childProcess.signalCode = signal ?? 'SIGKILL';
      childProcess.emit('close');
      return true;
    }

    return true;
  });

  return childProcess;
};

const createAwaitableSubprocess = (childProcess: MockChildProcess) => {
  const outputs = ['alpha', 'beta'];
  const result = Promise.resolve({
    command: 'example --flag',
    durationMs: 1,
    output: '',
    stderr: '',
    stdout: '',
  });

  return Object.assign(result, {
    nodeChildProcess: Promise.resolve(childProcess),
    [Symbol.asyncIterator]: async function* () {
      yield* outputs;
    },
    then: result.then.bind(result),
  });
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockNanoSpawn.spawn.mockReset();
});

describe('spawn', () => {
  it('stays awaitable and async-iterable', async () => {
    const childProcess = createMockChildProcess();
    mockNanoSpawn.spawn.mockReturnValue(createAwaitableSubprocess(childProcess));

    const subprocess = spawn('example', ['--flag']);

    await expect(subprocess).resolves.toMatchObject({
      command: 'example --flag',
    });

    await expect(
      (async () => {
        const lines: string[] = [];
        for await (const line of subprocess) {
          lines.push(String(line));
        }
        return lines;
      })()
    ).resolves.toEqual(['alpha', 'beta']);
  });

  it('installs process signal listeners and tracks the subprocess', () => {
    const onSpy = vi.spyOn(process, 'on');
    const onceSpy = vi.spyOn(process, 'once');
    const childProcess = createMockChildProcess();
    mockNanoSpawn.spawn.mockReturnValue(createAwaitableSubprocess(childProcess));

    spawn('example');

    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(onceSpy).not.toHaveBeenCalled();
  });

  it('terminates gracefully with SIGTERM first', async () => {
    vi.useFakeTimers();
    const childProcess = createMockChildProcess({ exitOnKill: 'SIGTERM' });
    mockNanoSpawn.spawn.mockReturnValue(createAwaitableSubprocess(childProcess));

    const subprocess = spawn('example');
    const terminatePromise = subprocess.terminate({ forceAfterMs: 1000 });

    await Promise.resolve();

    expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(childProcess.kill).not.toHaveBeenCalledWith('SIGKILL');

    await terminatePromise;
  });

  it('escalates to SIGKILL after forceAfterMs', async () => {
    vi.useFakeTimers();
    const childProcess = createMockChildProcess();
    mockNanoSpawn.spawn.mockReturnValue(createAwaitableSubprocess(childProcess));

    const subprocess = spawn('example');
    const terminatePromise = subprocess.terminate({ forceAfterMs: 1000 });

    await Promise.resolve();
    expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(childProcess.kill).toHaveBeenCalledWith('SIGKILL');
    await terminatePromise;
  });

  it('no-ops for already exited subprocesses', async () => {
    const childProcess = createMockChildProcess();
    childProcess.exitCode = 0;
    mockNanoSpawn.spawn.mockReturnValue(createAwaitableSubprocess(childProcess));

    const subprocess = spawn('example');
    await subprocess.terminate();

    expect(childProcess.kill).not.toHaveBeenCalled();
  });
});
