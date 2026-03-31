import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getAndroidEmulatorPlatformInstance,
  getAndroidPhysicalDevicePlatformInstance,
} from '../instance.js';
import * as adb from '../adb.js';
import * as sharedPrefs from '../shared-prefs.js';
import { HarnessAppPathError, HarnessEmulatorConfigError } from '../errors.js';

const harnessConfig = {
  metroPort: DEFAULT_METRO_PORT,
} as HarnessConfig;

describe('Android platform instance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('reuses a running emulator and does not shut it down on dispose', async () => {
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue(undefined);
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined
    );
    vi.spyOn(sharedPrefs, 'clearHarnessDebugHttpHost').mockResolvedValue(
      undefined
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
      harnessConfig
    );

    await instance.dispose();

    expect(stopEmulator).not.toHaveBeenCalled();
  });

  it('creates and boots an emulator when missing and shuts it down on dispose', async () => {
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue([]);
    vi.spyOn(adb, 'hasAvd').mockResolvedValue(false);
    const createAvd = vi.spyOn(adb, 'createAvd').mockResolvedValue(undefined);
    const startEmulator = vi
      .spyOn(adb, 'startEmulator')
      .mockResolvedValue(undefined);
    vi.spyOn(adb, 'waitForEmulator').mockResolvedValue('emulator-5554');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue(undefined);
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined
    );
    vi.spyOn(sharedPrefs, 'clearHarnessDebugHttpHost').mockResolvedValue(
      undefined
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
      harnessConfig
    );

    expect(createAvd).toHaveBeenCalledWith({
      name: 'Pixel_8_API_35',
      apiLevel: 35,
      profile: 'pixel_8',
      diskSize: '1G',
      heapSize: '1G',
    });
    expect(startEmulator).toHaveBeenCalledWith('Pixel_8_API_35');

    await instance.dispose();

    expect(stopEmulator).toHaveBeenCalledWith('emulator-5554');
  });

  it('installs the app from HARNESS_APP_PATH when missing', async () => {
    const appPath = path.join(os.tmpdir(), 'HarnessPlayground.apk');
    fs.writeFileSync(appPath, 'apk');
    vi.stubEnv('HARNESS_APP_PATH', appPath);
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue(undefined);
    vi.spyOn(adb, 'isAppInstalled').mockResolvedValue(false);
    const installApp = vi.spyOn(adb, 'installApp').mockResolvedValue(undefined);
    vi.spyOn(adb, 'reversePort').mockResolvedValue(undefined);
    vi.spyOn(adb, 'setHideErrorDialogs').mockResolvedValue(undefined);
    vi.spyOn(adb, 'getAppUid').mockResolvedValue(10234);
    vi.spyOn(sharedPrefs, 'applyHarnessDebugHttpHost').mockResolvedValue(
      undefined
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
        harnessConfig
      )
    ).resolves.toBeDefined();

    expect(installApp).toHaveBeenCalledWith('emulator-5554', appPath);

    fs.rmSync(appPath, { force: true });
  });

  it('throws a HarnessAppPathError when HARNESS_APP_PATH is missing', async () => {
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue(undefined);
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
        harnessConfig
      )
    ).rejects.toBeInstanceOf(HarnessAppPathError);
  });

  it('throws a HarnessAppPathError when HARNESS_APP_PATH points to a missing app', async () => {
    vi.stubEnv('HARNESS_APP_PATH', '/tmp/missing.apk');
    vi.spyOn(adb, 'getDeviceIds').mockResolvedValue(['emulator-5554']);
    vi.spyOn(adb, 'getEmulatorName').mockResolvedValue('Pixel_8_API_35');
    vi.spyOn(adb, 'waitForBoot').mockResolvedValue(undefined);
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
        harnessConfig
      )
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
        harnessConfig
      )
    ).rejects.toBeInstanceOf(HarnessEmulatorConfigError);
  });

  it('keeps physical device behavior unchanged', async () => {
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
      undefined
    );

    await expect(
      getAndroidPhysicalDevicePlatformInstance(
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
        harnessConfig
      )
    ).resolves.toBeDefined();
  });
});
