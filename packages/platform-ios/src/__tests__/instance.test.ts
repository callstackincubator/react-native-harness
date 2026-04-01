import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import {
  getApplePhysicalDevicePlatformInstance,
  getAppleSimulatorPlatformInstance,
} from '../instance.js';
import * as simctl from '../xcrun/simctl.js';
import * as devicectl from '../xcrun/devicectl.js';
import * as libimobiledevice from '../libimobiledevice.js';

const harnessConfig = {
  metroPort: DEFAULT_METRO_PORT,
} as HarnessConfig;

const harnessConfigWithoutNativeCrashDetection = {
  metroPort: DEFAULT_METRO_PORT,
  detectNativeCrashes: false,
} as HarnessConfig;

describe('iOS platform instance dependency validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not validate libimobiledevice before creating a simulator instance', async () => {
    const assertInstalled = vi
      .spyOn(libimobiledevice, 'assertLibimobiledeviceInstalled')
      .mockResolvedValue(undefined);
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );

    const config = {
      name: 'ios',
      device: { type: 'simulator' as const, name: 'iPhone 16 Pro', systemVersion: '18.0' },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getAppleSimulatorPlatformInstance(config, harnessConfig)
    ).resolves.toBeDefined();
    expect(assertInstalled).not.toHaveBeenCalled();
  });

  it('validates libimobiledevice before creating a physical device instance when native crash detection is enabled', async () => {
    const assertInstalled = vi
      .spyOn(libimobiledevice, 'assertLibimobiledeviceInstalled')
      .mockRejectedValue(new Error('missing'));

    const config = {
      name: 'ios-device',
      device: { type: 'physical' as const, name: 'My iPhone' },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getApplePhysicalDevicePlatformInstance(config, harnessConfig)
    ).rejects.toThrow('missing');
    expect(assertInstalled).toHaveBeenCalled();
  });

  it('still discovers the simulator without libimobiledevice', async () => {
    vi.spyOn(libimobiledevice, 'assertLibimobiledeviceInstalled').mockResolvedValue(
      undefined
    );
    const getSimulatorId = vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue(
      'sim-udid'
    );
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );

    const config = {
      name: 'ios',
      device: { type: 'simulator' as const, name: 'iPhone 16 Pro', systemVersion: '18.0' },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getAppleSimulatorPlatformInstance(config, harnessConfig)
    ).resolves.toBeDefined();
    expect(getSimulatorId).toHaveBeenCalled();
  });

  it('does not try to discover the physical device when the dependency is missing and native crash detection is enabled', async () => {
    vi.spyOn(libimobiledevice, 'assertLibimobiledeviceInstalled').mockRejectedValue(
      new Error('missing')
    );
    const getDeviceId = vi.spyOn(devicectl, 'getDeviceId');

    const config = {
      name: 'ios-device',
      device: { type: 'physical' as const, name: 'My iPhone' },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getApplePhysicalDevicePlatformInstance(config, harnessConfig)
    ).rejects.toThrow('missing');
    expect(getDeviceId).not.toHaveBeenCalled();
  });

  it('skips libimobiledevice validation when native crash detection is disabled', async () => {
    const assertInstalled = vi
      .spyOn(libimobiledevice, 'assertLibimobiledeviceInstalled')
      .mockRejectedValue(new Error('missing'));
    vi.spyOn(devicectl, 'getDevice').mockResolvedValue({
      identifier: 'physical-device-id',
      deviceProperties: {
        name: 'My iPhone',
        osVersionNumber: '18.0',
      },
      hardwareProperties: {
        marketingName: 'iPhone',
        productType: 'iPhone17,1',
        udid: '00008140-001600222422201C',
      },
    });
    vi.spyOn(devicectl, 'isAppInstalled').mockResolvedValue(true);

    const config = {
      name: 'ios-device',
      device: { type: 'physical' as const, name: 'My iPhone' },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getApplePhysicalDevicePlatformInstance(
        config,
        harnessConfigWithoutNativeCrashDetection
      )
    ).resolves.toBeDefined();
    expect(assertInstalled).not.toHaveBeenCalled();
  });
});
