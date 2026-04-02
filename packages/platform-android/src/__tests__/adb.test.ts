import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubprocessError } from '@react-native-harness/tools';
import {
  createAvd,
  deleteAvd,
  emulatorProcess,
  getAppUid,
  getLogcatTimestamp,
  getStartAppArgs,
  hasAvd,
  installApp,
  startEmulator,
  waitForBoot,
  waitForEmulatorDisconnect,
} from '../adb.js';
import * as tools from '@react-native-harness/tools';
import * as environment from '../environment.js';

const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

const createMockChildProcess = () => {
  const process = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    unref: ReturnType<typeof vi.fn>;
  };

  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.unref = vi.fn();

  return process;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getStartAppArgs', () => {
  it('maps supported extras to adb am start flags', () => {
    expect(
      getStartAppArgs('com.example.app', '.MainActivity', {
        extras: {
          feature_flag: true,
          user_id: 42,
          mode: 'debug',
        },
      })
    ).toEqual([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      '-n',
      'com.example.app/.MainActivity',
      '--ez',
      'feature_flag',
      'true',
      '--ei',
      'user_id',
      '42',
      '--es',
      'mode',
      'debug',
    ]);
  });

  it('rejects unsafe integer extras', () => {
    expect(() =>
      getStartAppArgs('com.example.app', '.MainActivity', {
        extras: {
          count: Number.MAX_SAFE_INTEGER + 1,
        },
      })
    ).toThrow('must be a safe integer');
  });

  it('extracts app uid from pm list packages output', async () => {
    const spawnSpy = vi.spyOn(tools, 'spawn').mockResolvedValueOnce({
      stdout:
        'package:com.other.app uid:10123\npackage:com.example.app uid:10234\n',
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await expect(getAppUid('emulator-5554', 'com.example.app')).resolves.toBe(
      10234
    );

    expect(spawnSpy).toHaveBeenCalledWith(expect.stringMatching(/adb$/), [
      '-s',
      'emulator-5554',
      'shell',
      'pm',
      'list',
      'packages',
      '-U',
    ]);
  });

  it('reads the device timestamp in logcat format', async () => {
    const spawnSpy = vi.spyOn(tools, 'spawn').mockResolvedValueOnce({
      stdout: "'03-12 11:35:08.000'\n",
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await expect(getLogcatTimestamp('emulator-5554')).resolves.toBe(
      '03-12 11:35:08.000'
    );

    expect(spawnSpy).toHaveBeenCalledWith(expect.stringMatching(/adb$/), [
      '-s',
      'emulator-5554',
      'shell',
      'date',
      "+'%m-%d %H:%M:%S.000'",
    ]);
  });

  it('checks whether an AVD exists', async () => {
    vi.spyOn(tools, 'spawn').mockResolvedValueOnce({
      stdout: 'Pixel_6_API_33\nPixel_8_API_35\n',
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await expect(hasAvd('Pixel_8_API_35')).resolves.toBe(true);
    await expect(hasAvd('Missing_AVD')).resolves.toBe(false);
  });

  it('installs the app via adb', async () => {
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof tools.spawn>>);

    await installApp('emulator-5554', '/tmp/app.apk');

    expect(spawnSpy).toHaveBeenCalledWith(expect.stringMatching(/adb$/), [
      '-s',
      'emulator-5554',
      'install',
      '-r',
      '/tmp/app.apk',
    ]);
  });

  it('creates an AVD and appends config overrides', async () => {
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValue({} as Awaited<ReturnType<typeof tools.spawn>>);
    const verifyAndroidEmulatorSdk = vi
      .spyOn(environment, 'ensureAndroidSdkPackages')
      .mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(environment, 'getHostAndroidSystemImageArch').mockReturnValue(
      'x86_64'
    );

    await createAvd({
      name: 'Pixel_8_API_35',
      apiLevel: 35,
      profile: 'pixel_8',
      diskSize: '1G',
      heapSize: '1G',
    });

    expect(verifyAndroidEmulatorSdk).toHaveBeenCalledWith([
      'platform-tools',
      'emulator',
      'platforms;android-35',
      'system-images;android-35;default;x86_64',
    ]);
    expect(spawnSpy).toHaveBeenNthCalledWith(1, 'bash', [
      '-lc',
      expect.stringContaining(
        'create avd --force --name "Pixel_8_API_35" --package "system-images;android-35;default;x86_64" --device "pixel_8"'
      ),
    ]);
    expect(spawnSpy).toHaveBeenNthCalledWith(2, 'bash', [
      '-lc',
      expect.stringContaining(
        `'disk.dataPartition.size=1G' 'vm.heapSize=1G' >> `
      ),
    ]);
  });

  it('creates an AVD with arm64 system image packages on arm64 hosts', async () => {
    vi.spyOn(tools, 'spawn').mockResolvedValue(
      {} as Awaited<ReturnType<typeof tools.spawn>>
    );
    const ensureAndroidSdkPackages = vi
      .spyOn(environment, 'ensureAndroidSdkPackages')
      .mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(environment, 'getHostAndroidSystemImageArch').mockReturnValue(
      'arm64-v8a'
    );

    await createAvd({
      name: 'Pixel_8_API_35',
      apiLevel: 35,
      profile: 'pixel_8',
      diskSize: '1G',
      heapSize: '1G',
    });

    expect(ensureAndroidSdkPackages).toHaveBeenCalledWith([
      'platform-tools',
      'emulator',
      'platforms;android-35',
      'system-images;android-35;default;arm64-v8a',
    ]);
  });

  it.skip('deletes both AVD directory and ini file', async () => {
    await deleteAvd('Pixel_8_API_35');
  });

  it('surfaces emulator stdout when startup fails immediately', async () => {
    const child = createMockChildProcess();
    let launcherReadyResolve: (() => void) | undefined;
    const launcherReady = new Promise<void>((resolve) => {
      launcherReadyResolve = resolve;
    });

    vi.spyOn(tools, 'spawn').mockResolvedValue({
      stdout: 'List of devices attached\n\n',
    } as Awaited<ReturnType<typeof tools.spawn>>);
    vi.spyOn(emulatorProcess, 'startDetachedProcess').mockImplementation(() => {
      launcherReadyResolve?.();
      return child as unknown as ReturnType<
        typeof emulatorProcess.startDetachedProcess
      >;
    });

    const startPromise = startEmulator('Pixel_8_API_35');
    await launcherReady;

    child.stdout.write('Unknown AVD name [Pixel_8_API_35]\n');
    child.stdout.end();
    child.stderr.end();
    child.emit('close', 1, null);

    await expect(startPromise).rejects.toThrow(
      'Unknown AVD name [Pixel_8_API_35]'
    );
  });

  it('surfaces emulator stderr when startup fails immediately', async () => {
    const child = createMockChildProcess();
    let launcherReadyResolve: (() => void) | undefined;
    const launcherReady = new Promise<void>((resolve) => {
      launcherReadyResolve = resolve;
    });

    vi.spyOn(tools, 'spawn').mockResolvedValue({
      stdout: 'List of devices attached\n\n',
    } as Awaited<ReturnType<typeof tools.spawn>>);
    vi.spyOn(emulatorProcess, 'startDetachedProcess').mockImplementation(() => {
      launcherReadyResolve?.();
      return child as unknown as ReturnType<
        typeof emulatorProcess.startDetachedProcess
      >;
    });

    const startPromise = startEmulator('Pixel_8_API_35');
    await launcherReady;

    child.stderr.write('emulator: panic: broken config\n');
    child.stdout.end();
    child.stderr.end();
    child.emit('close', 1, null);

    await expect(startPromise).rejects.toThrow(
      'emulator: panic: broken config'
    );
  });

  it('returns after the emulator appears without waiting for process exit', async () => {
    vi.useFakeTimers();
    const child = createMockChildProcess();
    const spawnSpy = vi.spyOn(tools, 'spawn');

    spawnSpy
      .mockResolvedValueOnce({
        stdout: 'List of devices attached\nemulator-5554\tdevice\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: 'Pixel_8_API_35\n',
      } as Awaited<ReturnType<typeof tools.spawn>>);

    vi.spyOn(emulatorProcess, 'startDetachedProcess').mockReturnValue(
      child as unknown as ReturnType<
        typeof emulatorProcess.startDetachedProcess
      >
    );

    const startPromise = startEmulator('Pixel_8_API_35');

    await vi.runAllTimersAsync();

    await expect(startPromise).resolves.toBeUndefined();
    expect(child.unref).toHaveBeenCalled();
  });

  it('passes default boot args to the emulator process', async () => {
    vi.useFakeTimers();
    const child = createMockChildProcess();
    vi.spyOn(tools, 'spawn')
      .mockResolvedValueOnce({
        stdout: 'List of devices attached\nemulator-5554\tdevice\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: 'Pixel_8_API_35\n',
      } as Awaited<ReturnType<typeof tools.spawn>>);
    const startDetachedProcess = vi
      .spyOn(emulatorProcess, 'startDetachedProcess')
      .mockReturnValue(
        child as unknown as ReturnType<
          typeof emulatorProcess.startDetachedProcess
        >
      );

    const startPromise = startEmulator('Pixel_8_API_35');
    await vi.runAllTimersAsync();
    await startPromise;

    expect(startDetachedProcess).toHaveBeenCalledWith(
      expect.stringMatching(/emulator$/),
      expect.arrayContaining(['-no-snapshot-load', '-no-snapshot-save'])
    );
  });

  it('passes clean snapshot generation args to the emulator process', async () => {
    vi.useFakeTimers();
    const child = createMockChildProcess();
    vi.spyOn(tools, 'spawn')
      .mockResolvedValueOnce({
        stdout: 'List of devices attached\nemulator-5554\tdevice\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: 'Pixel_8_API_35\n',
      } as Awaited<ReturnType<typeof tools.spawn>>);
    const startDetachedProcess = vi
      .spyOn(emulatorProcess, 'startDetachedProcess')
      .mockReturnValue(
        child as unknown as ReturnType<
          typeof emulatorProcess.startDetachedProcess
        >
      );

    const startPromise = startEmulator(
      'Pixel_8_API_35',
      'clean-snapshot-generation'
    );
    await vi.runAllTimersAsync();
    await startPromise;

    expect(startDetachedProcess).toHaveBeenCalledWith(
      expect.stringMatching(/emulator$/),
      expect.arrayContaining(['-no-snapshot-load'])
    );
    expect(startDetachedProcess.mock.calls[0]?.[1]).not.toContain(
      '-no-snapshot-save'
    );
  });

  it('passes snapshot reuse args to the emulator process', async () => {
    vi.useFakeTimers();
    const child = createMockChildProcess();
    vi.spyOn(tools, 'spawn')
      .mockResolvedValueOnce({
        stdout: 'List of devices attached\nemulator-5554\tdevice\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: 'Pixel_8_API_35\n',
      } as Awaited<ReturnType<typeof tools.spawn>>);
    const startDetachedProcess = vi
      .spyOn(emulatorProcess, 'startDetachedProcess')
      .mockReturnValue(
        child as unknown as ReturnType<
          typeof emulatorProcess.startDetachedProcess
        >
      );

    const startPromise = startEmulator('Pixel_8_API_35', 'snapshot-reuse');
    await vi.runAllTimersAsync();
    await startPromise;

    expect(startDetachedProcess).toHaveBeenCalledWith(
      expect.stringMatching(/emulator$/),
      expect.arrayContaining(['-no-snapshot-save'])
    );
    expect(startDetachedProcess.mock.calls[0]?.[1]).not.toContain(
      '-no-snapshot-load'
    );
  });

  it('aborts while waiting for an emulator to boot', async () => {
    vi.useFakeTimers();
    vi.spyOn(tools, 'spawn').mockResolvedValue({
      stdout: 'List of devices attached\n\n',
    } as Awaited<ReturnType<typeof tools.spawn>>);
    const controller = new AbortController();
    const waitPromise = waitForBoot('Pixel_8_API_35', controller.signal);

    await vi.advanceTimersByTimeAsync(1000);
    controller.abort(createAbortError());

    await expect(waitPromise).rejects.toBeInstanceOf(DOMException);
  });

  it('aborts while waiting for boot completion', async () => {
    vi.useFakeTimers();
    const spawnSpy = vi.spyOn(tools, 'spawn');
    spawnSpy
      .mockResolvedValueOnce({
        stdout: 'List of devices attached\nemulator-5554\tdevice\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: 'Pixel_8_API_35\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: '0\n',
      } as Awaited<ReturnType<typeof tools.spawn>>);
    const controller = new AbortController();
    const waitPromise = waitForBoot('Pixel_8_API_35', controller.signal);

    await vi.advanceTimersByTimeAsync(1000);
    controller.abort(createAbortError());

    await expect(waitPromise).rejects.toBeInstanceOf(DOMException);
  });

  it('treats transient adb shell failures as not-yet-booted', async () => {
    vi.useFakeTimers();
    const spawnSpy = vi.spyOn(tools, 'spawn');
    const transientShellError = Object.assign(new Error('adb shell failed'), {
      exitCode: 1,
    });
    Object.setPrototypeOf(transientShellError, SubprocessError.prototype);

    spawnSpy
      .mockResolvedValueOnce({
        stdout: 'List of devices attached\nemulator-5554\tdevice\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: 'Pixel_8_API_35\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockRejectedValueOnce(transientShellError)
      .mockResolvedValueOnce({
        stdout: 'List of devices attached\nemulator-5554\tdevice\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: 'Pixel_8_API_35\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: '1\n',
      } as Awaited<ReturnType<typeof tools.spawn>>);

    const waitPromise = waitForBoot(
      'Pixel_8_API_35',
      new AbortController().signal
    );

    await vi.advanceTimersByTimeAsync(1000);

    await expect(waitPromise).resolves.toBe('emulator-5554');
    expect(spawnSpy).toHaveBeenCalledTimes(6);
  });

  it('waits for an emulator to disconnect from adb', async () => {
    vi.useFakeTimers();
    const spawnSpy = vi.spyOn(tools, 'spawn');

    spawnSpy
      .mockResolvedValueOnce({
        stdout: 'List of devices attached\nemulator-5554\tdevice\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: 'List of devices attached\n\n',
      } as Awaited<ReturnType<typeof tools.spawn>>);

    const waitPromise = waitForEmulatorDisconnect(
      'emulator-5554',
      new AbortController().signal
    );

    await vi.advanceTimersByTimeAsync(1000);

    await expect(waitPromise).resolves.toBeUndefined();
    expect(spawnSpy).toHaveBeenCalledTimes(2);
  });
});
