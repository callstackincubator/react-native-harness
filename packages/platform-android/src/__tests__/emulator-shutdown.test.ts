import { EventEmitter } from 'node:events';
import type { ChildProcessByStdio } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('../adb.js', () => vi.importActual('../adb.js'));
vi.mock('../environment.js', async () => {
  const actual = await vi.importActual<typeof import('../environment.js')>(
    '../environment.js'
  );
  return {
    ...actual,
    ensureAndroidEmulatorAvailable: vi.fn(),
    getEmulatorBinaryPath: () => process.execPath,
    getAdbBinaryPath: () => '/fake/adb',
  };
});
vi.mock('@react-native-harness/tools', async () => {
  const actual = await vi.importActual<
    typeof import('@react-native-harness/tools')
  >('@react-native-harness/tools');
  return { ...actual, spawn: mocks.spawn };
});

const { emulatorProcess, startEmulator, stopEmulator } = await import(
  '../adb.js'
);

const createEmulatorProcess = () =>
  Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    unref: vi.fn(),
    exitCode: null as number | null,
    signalCode: null,
  });

let child: ReturnType<typeof createEmulatorProcess>;

beforeEach(() => {
  child = createEmulatorProcess();
  vi.spyOn(emulatorProcess, 'startDetachedProcess').mockReturnValue(
    child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>
  );
  mocks.spawn.mockImplementation(async (_file: string, args: string[]) => ({
    stdout:
      args[0] === 'devices'
        ? 'List of devices attached\nemulator-5554\tdevice\n'
        : 'Test_AVD\nOK\n',
  }));
});

afterEach(() => {
  child.exitCode = 0;
  child.emit('exit', 0, null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Android emulator shutdown', () => {
  it('waits for process exit after adb acknowledges shutdown', async () => {
    await startEmulator('Test_AVD');
    const stopped = vi.fn();
    const shutdown = stopEmulator('emulator-5554', 'Test_AVD').then(stopped);
    await vi.waitFor(() => {
      expect(mocks.spawn).toHaveBeenCalledWith('/fake/adb', [
        '-s',
        'emulator-5554',
        'emu',
        'kill',
      ]);
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    // ADB can disconnect while the emulator is still writing its snapshot.
    expect(stopped).not.toHaveBeenCalled();
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await shutdown;
    expect(stopped).toHaveBeenCalledOnce();
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('handles an exit before the adb command returns', async () => {
    await startEmulator('Test_AVD');
    mocks.spawn.mockImplementationOnce(async () => {
      child.exitCode = 0;
      child.emit('exit', 0, null);
      return { stdout: 'OK\n' };
    });
    await stopEmulator('emulator-5554', 'Test_AVD');
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('does not wait for an unrelated emulator process', async () => {
    await startEmulator('Test_AVD');
    await stopEmulator('emulator-5556', 'Other_AVD');
    expect(child.listenerCount('exit')).toBe(1);
  });

  it('propagates a failed shutdown request without adding an exit listener', async () => {
    await startEmulator('Test_AVD');
    mocks.spawn.mockRejectedValueOnce(new Error('adb connection failed'));
    await expect(stopEmulator('emulator-5554', 'Test_AVD')).rejects.toThrow(
      'adb connection failed'
    );
    expect(child.listenerCount('exit')).toBe(1);
  });

  it('reports an emulator that never exits and removes its shutdown listener', async () => {
    await startEmulator('Test_AVD');
    vi.useFakeTimers();
    const shutdown = stopEmulator('emulator-5554', 'Test_AVD');
    const rejected = expect(shutdown).rejects.toThrow(
      'Android emulator @Test_AVD did not exit after shutdown.'
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(child.listenerCount('exit')).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
