import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import type { Subprocess } from '@react-native-harness/tools';
import {
  getAndroidEmulatorPlatformInstance,
  getAndroidPhysicalDevicePlatformInstance,
} from '../instance.js';
import * as adb from '../adb.js';
import * as avdConfig from '../avd-config.js';
import * as sharedPrefs from '../shared-prefs.js';
import { HarnessAppPathError, HarnessEmulatorConfigError } from '../errors.js';

const createLogcatProcess = (lines: string[] = []): Subprocess => {
  const process = {
    nodeChildProcess: Promise.resolve({
      kill: vi.fn(),
    }),
    [Symbol.asyncIterator]: async function* () {
      for (const line of lines) {
        yield line;
      }
    },
  };

  return process as unknown as Subprocess;
};

const harnessConfig = {
  metroPort: DEFAULT_METRO_PORT,
} as HarnessConfig;
const harnessConfigWithoutNativeCrashDetection = {
  metroPort: DEFAULT_METRO_PORT,
  detectNativeCrashes: false,
} as HarnessConfig;
const init = {
  signal: new AbortController().signal,
};

describe('Android platform instance', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.spyOn(
      await import('../environment.js'),
      'ensureAndroidEmulatorAvailable',
    ).mockResolvedValue('/tmp/android-sdk');
  });

  it('reuses a running emulator and does not shut it down on dispose', async () => {
    const ensureAndroidEmulatorEnvironment = vi
      .spyOn(
        await import('../environment.js'),
        'ensureAndroidEmulatorEnvironment',
      )
      .mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue(
      '01-01 00:00:00.000',
    );
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    vi.spyOn(sharedPrefs, 'clearHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    vi.spyOn(adb, 'stopApp').mockResolvedValue(undefined);
    const stopEmulator = vi.spyOn(adb, 'stopEmulator').mockResolvedValue();

    const instance = await getAndroidEmulatorPlatformInstance(
      {
        name: 'android',
        device: {
          type: 'emulator',
          name: 'Pixel_8_API_35',
          avd: {
            apiLevel: 35,
            profile: 'pixel_8',
            diskSize: '1G',
            heapSize: '1G',
          },
        },
        bundleId: 'com.harnessplayground',
        activityName: '.MainActivity',
      },
      harnessConfig,
      init,
    );

    await instance.dispose();

    expect(ensureAndroidEmulatorEnvironment).not.toHaveBeenCalled();
    expect(stopEmulator).not.toHaveBeenCalled();
  });

  it('creates and boots an emulator when missing and shuts it down on dispose', async () => {
    vi.spyOn(
      await import('../environment.js'),
      'ensureAndroidEmulatorEnvironment',
    ).mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue([]);
    vi.spyOn(adb, 'hasAvd').mockResolvedValue(false);
    const createAvd = vi.spyOn(adb, 'createAvd').mockResolvedValue(undefined);
    const startEmulator = vi
      .spyOn(adb, 'startEmulator')
      .mockResolvedValue(undefined);
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue(
      '01-01 00:00:00.000',
    );
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    vi.spyOn(sharedPrefs, 'clearHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    vi.spyOn(adb, 'stopApp').mockResolvedValue(undefined);
    const stopEmulator = vi.spyOn(adb, 'stopEmulator').mockResolvedValue();

    const instance = await getAndroidEmulatorPlatformInstance(
      {
        name: 'android',
        device: {
          type: 'emulator',
          name: 'Pixel_8_API_35',
          avd: {
            apiLevel: 35,
            profile: 'pixel_8',
            diskSize: '1G',
            heapSize: '1G',
          },
        },
        bundleId: 'com.harnessplayground',
        activityName: '.MainActivity',
      },
      harnessConfig,
      init,
    );

    expect(createAvd).toHaveBeenCalledWith({
      name: 'Pixel_8_API_35',
      apiLevel: 35,
      profile: 'pixel_8',
      diskSize: '1G',
      heapSize: '1G',
    });
    expect(startEmulator).toHaveBeenCalledWith('Pixel_8_API_35', undefined);

    await instance.dispose();

    expect(stopEmulator).toHaveBeenCalledWith('emulator-5554');
  });

  it('verifies SDK assets before booting an existing AVD', async () => {
    const ensureAndroidEmulatorEnvironment = vi
      .spyOn(
        await import('../environment.js'),
        'ensureAndroidEmulatorEnvironment',
      )
      .mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue([]);
    vi.spyOn(adb, 'hasAvd').mockResolvedValue(true);
    const createAvd = vi.spyOn(adb, 'createAvd').mockResolvedValue(undefined);
    const startEmulator = vi
      .spyOn(adb, 'startEmulator')
      .mockResolvedValue(undefined);
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue(
      '01-01 00:00:00.000',
    );
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );

    await expect(
      getAndroidEmulatorPlatformInstance(
        {
          name: 'android',
          device: {
            type: 'emulator',
            name: 'Pixel_8_API_35',
            avd: {
              apiLevel: 35,
              profile: 'pixel_8',
              diskSize: '1G',
              heapSize: '1G',
            },
          },
          bundleId: 'com.harnessplayground',
          activityName: '.MainActivity',
        },
        harnessConfig,
        init,
      ),
    ).resolves.toBeDefined();

    expect(ensureAndroidEmulatorEnvironment).toHaveBeenCalledWith(35);
    expect(createAvd).not.toHaveBeenCalled();
    expect(startEmulator).toHaveBeenCalledWith('Pixel_8_API_35', undefined);
  });

  it('reuses a compatible cached AVD snapshot when caching is enabled', async () => {
    vi.stubEnv('HARNESS_AVD_CACHING', 'true');
    vi.spyOn(
      await import('../environment.js'),
      'getHostAndroidSystemImageArch',
    ).mockReturnValue('arm64-v8a');
    vi.spyOn(
      await import('../environment.js'),
      'ensureAndroidEmulatorEnvironment',
    ).mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue([]);
    vi.spyOn(adb, 'hasAvd').mockResolvedValue(true);
    vi.spyOn(avdConfig, 'readAvdConfig').mockResolvedValue({
      imageSysdir1: 'system-images/android-35/default/arm64-v8a/',
      abiType: 'arm64-v8a',
      hwDeviceName: 'pixel_8',
      diskDataPartitionSize: '1G',
      vmHeapSize: '1G',
    });
    vi.spyOn(adb, 'startEmulator').mockResolvedValue(undefined);
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue(
      '01-01 00:00:00.000',
    );
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );

    await expect(
      getAndroidEmulatorPlatformInstance(
        {
          name: 'android',
          device: {
            type: 'emulator',
            name: 'Pixel_8_API_35',
            avd: {
              apiLevel: 35,
              profile: 'pixel_8',
              diskSize: '1G',
              heapSize: '1G',
              snapshot: { enabled: false },
            },
          },
          bundleId: 'com.harnessplayground',
          activityName: '.MainActivity',
        },
        harnessConfig,
        init,
      ),
    ).resolves.toBeDefined();

    expect(adb.startEmulator).toHaveBeenCalledTimes(1);
    expect(adb.startEmulator).toHaveBeenCalledWith(
      'Pixel_8_API_35',
      'snapshot-reuse',
    );
  });

  it('recreates an incompatible cached AVD before the real boot', async () => {
    vi.stubEnv('HARNESS_AVD_CACHING', 'true');
    vi.spyOn(
      await import('../environment.js'),
      'ensureAndroidEmulatorEnvironment',
    ).mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue([]);
    vi.spyOn(adb, 'hasAvd').mockResolvedValue(true);
    vi.spyOn(avdConfig, 'readAvdConfig').mockResolvedValue({
      imageSysdir1: 'system-images/android-34/default/x86_64/',
      abiType: 'x86_64',
      hwDeviceName: 'pixel_7',
      diskDataPartitionSize: '2G',
      vmHeapSize: '2G',
    });
    const deleteAvd = vi.spyOn(adb, 'deleteAvd').mockResolvedValue(undefined);
    const createAvd = vi.spyOn(adb, 'createAvd').mockResolvedValue(undefined);
    vi.spyOn(adb, 'startEmulator').mockResolvedValue(undefined);
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    const stopEmulator = vi.spyOn(adb, 'stopEmulator').mockResolvedValue();
    const waitForEmulatorDisconnect = vi
      .spyOn(adb, 'waitForEmulatorDisconnect')
      .mockResolvedValue(undefined);
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue(
      '01-01 00:00:00.000',
    );
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );

    await expect(
      getAndroidEmulatorPlatformInstance(
        {
          name: 'android',
          device: {
            type: 'emulator',
            name: 'Pixel_8_API_35',
            avd: {
              apiLevel: 35,
              profile: 'pixel_8',
              diskSize: '1G',
              heapSize: '1G',
              snapshot: { enabled: true },
            },
          },
          bundleId: 'com.harnessplayground',
          activityName: '.MainActivity',
        },
        harnessConfig,
        init,
      ),
    ).resolves.toBeDefined();

    expect(deleteAvd).toHaveBeenCalledWith('Pixel_8_API_35');
    expect(createAvd).toHaveBeenCalled();
    expect(stopEmulator).toHaveBeenCalledWith('emulator-5554');
    expect(waitForEmulatorDisconnect).toHaveBeenCalledWith(
      'emulator-5554',
      init.signal,
    );
    expect(adb.startEmulator).toHaveBeenNthCalledWith(
      1,
      'Pixel_8_API_35',
      'clean-snapshot-generation',
    );
    expect(adb.startEmulator).toHaveBeenNthCalledWith(
      2,
      'Pixel_8_API_35',
      'snapshot-reuse',
    );
  });

  it('generates a snapshot on first run before the test boot', async () => {
    vi.stubEnv('HARNESS_AVD_CACHING', 'true');
    vi.spyOn(
      await import('../environment.js'),
      'ensureAndroidEmulatorEnvironment',
    ).mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue([]);
    vi.spyOn(adb, 'hasAvd').mockResolvedValue(false);
    vi.spyOn(adb, 'createAvd').mockResolvedValue(undefined);
    const startEmulator = vi
      .spyOn(adb, 'startEmulator')
      .mockResolvedValue(undefined);
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    const stopEmulator = vi.spyOn(adb, 'stopEmulator').mockResolvedValue();
    const waitForEmulatorDisconnect = vi
      .spyOn(adb, 'waitForEmulatorDisconnect')
      .mockResolvedValue(undefined);
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue(
      '01-01 00:00:00.000',
    );
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );

    await expect(
      getAndroidEmulatorPlatformInstance(
        {
          name: 'android',
          device: {
            type: 'emulator',
            name: 'Pixel_8_API_35',
            avd: {
              apiLevel: 35,
              profile: 'pixel_8',
              diskSize: '1G',
              heapSize: '1G',
              snapshot: { enabled: true },
            },
          },
          bundleId: 'com.harnessplayground',
          activityName: '.MainActivity',
        },
        harnessConfig,
        init,
      ),
    ).resolves.toBeDefined();

    expect(startEmulator).toHaveBeenNthCalledWith(
      1,
      'Pixel_8_API_35',
      'clean-snapshot-generation',
    );
    expect(stopEmulator).toHaveBeenCalledWith('emulator-5554');
    expect(waitForEmulatorDisconnect).toHaveBeenCalledWith(
      'emulator-5554',
      init.signal,
    );
    expect(startEmulator).toHaveBeenNthCalledWith(
      2,
      'Pixel_8_API_35',
      'snapshot-reuse',
    );
  });

  it('throws a HarnessAppPathError when HARNESS_APP_PATH is missing', async () => {
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(false);

    await expect(
      getAndroidEmulatorPlatformInstance(
        {
          name: 'android',
          device: {
            type: 'emulator',
            name: 'Pixel_8_API_35',
            avd: {
              apiLevel: 35,
              profile: 'pixel_8',
              diskSize: '1G',
              heapSize: '1G',
            },
          },
          bundleId: 'com.harnessplayground',
          activityName: '.MainActivity',
        },
        harnessConfig,
        init,
      ),
    ).rejects.toBeInstanceOf(HarnessAppPathError);
  });

  it('throws a HarnessAppPathError when HARNESS_APP_PATH points to a missing app', async () => {
    vi.stubEnv('HARNESS_APP_PATH', '/tmp/missing.apk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(false);

    await expect(
      getAndroidEmulatorPlatformInstance(
        {
          name: 'android',
          device: {
            type: 'emulator',
            name: 'Pixel_8_API_35',
            avd: {
              apiLevel: 35,
              profile: 'pixel_8',
              diskSize: '1G',
              heapSize: '1G',
            },
          },
          bundleId: 'com.harnessplayground',
          activityName: '.MainActivity',
        },
        harnessConfig,
        init,
      ),
    ).rejects.toBeInstanceOf(HarnessAppPathError);
  });

  it('throws a HarnessEmulatorConfigError when the emulator is missing and avd config is absent', async () => {
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue([]);

    await expect(
      getAndroidEmulatorPlatformInstance(
        {
          name: 'android',
          device: {
            type: 'emulator',
            name: 'Pixel_8_API_35',
          },
          bundleId: 'com.harnessplayground',
          activityName: '.MainActivity',
        },
        harnessConfig,
        init,
      ),
    ).rejects.toBeInstanceOf(HarnessEmulatorConfigError);
  });

  it('creates a real emulator app session when native crash detection is disabled', async () => {
    vi.useFakeTimers();
    vi.spyOn(
      await import('../environment.js'),
      'ensureAndroidEmulatorEnvironment',
    ).mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue(
      '01-01 00:00:00.000',
    );
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    const stopApp = vi.spyOn(adb, 'stopApp').mockResolvedValue(undefined);
    const startApp = vi.spyOn(adb, 'startApp').mockResolvedValue(undefined);
    const getAppPid = vi.spyOn(adb, 'getAppPid').mockResolvedValue(4321);
    const startLogcat = vi
      .spyOn(adb, 'startLogcat')
      .mockReturnValue(createLogcatProcess());

    const instance = await getAndroidEmulatorPlatformInstance(
      {
        name: 'android',
        device: {
          type: 'emulator',
          name: 'Pixel_8_API_35',
          avd: {
            apiLevel: 35,
            profile: 'pixel_8',
            diskSize: '1G',
            heapSize: '1G',
          },
        },
        bundleId: 'com.harnessplayground',
        activityName: '.MainActivity',
      },
      harnessConfigWithoutNativeCrashDetection,
      init,
    );

    const listener = vi.fn();
    const appSession = await instance.createAppSession();
    appSession.addListener(listener);
    await vi.advanceTimersByTimeAsync(0);

    expect(startLogcat).toHaveBeenCalledWith('emulator-5554', [
      'logcat',
      '-v',
      'threadtime',
      '-b',
      'crash',
      '--uid=10234',
      '-T',
      '01-01 00:00:00.000',
    ]);
    expect(startLogcat.mock.invocationCallOrder[0]).toBeLessThan(
      startApp.mock.invocationCallOrder[0],
    );
    await expect(appSession.getState()).resolves.toEqual({
      status: 'running',
      pid: 4321,
    });
    expect(getAppPid).toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(appSession.removeListener(listener)).toBeUndefined();
    await expect(appSession.dispose()).resolves.toBeUndefined();
    expect(stopApp).toHaveBeenCalled();
  });

  it('reports an early Android crash from logcat before a PID poll succeeds', async () => {
    vi.useFakeTimers();
    vi.spyOn(
      await import('../environment.js'),
      'ensureAndroidEmulatorEnvironment',
    ).mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue(
      '01-01 00:00:00.000',
    );
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    vi.spyOn(adb, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(adb, 'startApp').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppPid').mockResolvedValue(null);
    vi.spyOn(adb, 'startLogcat').mockReturnValue(
      createLogcatProcess([
        '--------- beginning of crash',
        'Process: com.harnessplayground, PID: 7777',
        'FATAL EXCEPTION: main',
      ]),
    );

    const instance = await getAndroidEmulatorPlatformInstance(
      {
        name: 'android',
        device: {
          type: 'emulator',
          name: 'Pixel_8_API_35',
          avd: {
            apiLevel: 35,
            profile: 'pixel_8',
            diskSize: '1G',
            heapSize: '1G',
          },
        },
        bundleId: 'com.harnessplayground',
        activityName: '.MainActivity',
      },
      harnessConfig,
      init,
    );

    const listener = vi.fn();
    const appSession = await instance.createAppSession();
    appSession.addListener(listener);

    await vi.advanceTimersByTimeAsync(0);

    expect(appSession.getLogs().map((entry) => entry.line)).toEqual([
      '--------- beginning of crash',
      'Process: com.harnessplayground, PID: 7777',
      'FATAL EXCEPTION: main',
    ]);
    await expect(appSession.getState()).resolves.toMatchObject({
      status: 'exited',
      pid: 7777,
      reason: 'observed-exit',
    });
    expect(listener).toHaveBeenCalledWith({ type: 'app_exited' });

    await appSession.dispose();
  });

  it('creates a real physical-device app session when native crash detection is disabled', async () => {
    vi.useFakeTimers();
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['012345']);
    vi.spyOn(adb, 'getDeviceInfo').mockResolvedValue({
      manufacturer: 'motorola',
      model: 'moto g72',
    });
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(adb, 'getLogcatTimestamp').mockResolvedValue(
      '01-01 00:00:00.000',
    );
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    vi.spyOn(adb, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(adb, 'startApp').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppPid').mockResolvedValue(8765);
    const startLogcat = vi
      .spyOn(adb, 'startLogcat')
      .mockReturnValue(createLogcatProcess());

    const instance = await getAndroidPhysicalDevicePlatformInstance(
      {
        name: 'android-device',
        device: {
          type: 'physical',
          manufacturer: 'motorola',
          model: 'moto g72',
        },
        bundleId: 'com.harnessplayground',
        activityName: '.MainActivity',
      },
      harnessConfigWithoutNativeCrashDetection,
    );

    const listener = vi.fn();
    const appSession = await instance.createAppSession();
    appSession.addListener(listener);
    await vi.advanceTimersByTimeAsync(0);

    expect(startLogcat).toHaveBeenCalledWith('012345', [
      'logcat',
      '-v',
      'threadtime',
      '-b',
      'crash',
      '--uid=10234',
      '-T',
      '01-01 00:00:00.000',
    ]);
    await expect(appSession.getState()).resolves.toEqual({
      status: 'running',
      pid: 8765,
    });
    expect(listener).not.toHaveBeenCalled();
    expect(appSession.removeListener(listener)).toBeUndefined();
    await expect(appSession.dispose()).resolves.toBeUndefined();
  });

  it('grants permissions when permissions are enabled for emulator', async () => {
    vi.spyOn(
      await import('../environment.js'),
      'ensureAndroidEmulatorEnvironment',
    ).mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    const grantPermissions = vi
      .spyOn(adb, 'grantPermissions')
      .mockResolvedValue(undefined);

    const harnessConfigWithPermissions = {
      ...harnessConfig,
      permissions: true,
    } as HarnessConfig;

    await getAndroidEmulatorPlatformInstance(
      {
        name: 'android',
        device: {
          type: 'emulator',
          name: 'Pixel_8_API_35',
          avd: {
            apiLevel: 35,
            profile: 'pixel_8',
            diskSize: '1G',
            heapSize: '1G',
          },
        },
        bundleId: 'com.harnessplayground',
        activityName: '.MainActivity',
      },
      harnessConfigWithPermissions,
      init,
    );

    expect(grantPermissions).toHaveBeenCalledWith(
      'emulator-5554',
      'com.harnessplayground',
    );
  });

  it('does not grant permissions when permissions are disabled for emulator', async () => {
    vi.spyOn(
      await import('../environment.js'),
      'ensureAndroidEmulatorEnvironment',
    ).mockResolvedValue('/tmp/android-sdk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    const grantPermissions = vi
      .spyOn(adb, 'grantPermissions')
      .mockResolvedValue(undefined);

    await getAndroidEmulatorPlatformInstance(
      {
        name: 'android',
        device: {
          type: 'emulator',
          name: 'Pixel_8_API_35',
          avd: {
            apiLevel: 35,
            profile: 'pixel_8',
            diskSize: '1G',
            heapSize: '1G',
          },
        },
        bundleId: 'com.harnessplayground',
        activityName: '.MainActivity',
      },
      harnessConfig,
      init,
    );

    expect(grantPermissions).not.toHaveBeenCalled();
  });

  it('grants permissions when permissions are enabled for physical device', async () => {
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['012345']);
    vi.spyOn(adb, 'getDeviceInfo').mockResolvedValue({
      manufacturer: 'motorola',
      model: 'moto g72',
    });
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined,
    );
    const grantPermissions = vi
      .spyOn(adb, 'grantPermissions')
      .mockResolvedValue(undefined);

    const harnessConfigWithPermissions = {
      ...harnessConfig,
      permissions: true,
    } as HarnessConfig;

    await getAndroidPhysicalDevicePlatformInstance(
      {
        name: 'android-device',
        device: {
          type: 'physical',
          manufacturer: 'motorola',
          model: 'moto g72',
        },
        bundleId: 'com.harnessplayground',
        activityName: '.MainActivity',
      },
      harnessConfigWithPermissions,
    );

    expect(grantPermissions).toHaveBeenCalledWith(
      '012345',
      'com.harnessplayground',
    );
  });
});
