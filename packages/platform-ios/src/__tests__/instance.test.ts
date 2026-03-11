import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getApplePhysicalDevicePlatformInstance,
  getAppleSimulatorPlatformInstance,
} from '../instance.js';
import * as simctl from '../xcrun/simctl.js';
import * as devicectl from '../xcrun/devicectl.js';
import * as libimobiledevice from '../libimobiledevice.js';

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

    const config = {
      name: 'ios',
      device: { type: 'simulator' as const, name: 'iPhone 16 Pro', systemVersion: '18.0' },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getAppleSimulatorPlatformInstance(config)
    ).resolves.toBeDefined();
    expect(assertInstalled).not.toHaveBeenCalled();
  });

  it('validates libimobiledevice before creating a physical device instance', async () => {
    const assertInstalled = vi
      .spyOn(libimobiledevice, 'assertLibimobiledeviceInstalled')
      .mockRejectedValue(new Error('missing'));

    const config = {
      name: 'ios-device',
      device: { type: 'physical' as const, name: 'My iPhone' },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getApplePhysicalDevicePlatformInstance(config)
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

    const config = {
      name: 'ios',
      device: { type: 'simulator' as const, name: 'iPhone 16 Pro', systemVersion: '18.0' },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getAppleSimulatorPlatformInstance(config)
    ).resolves.toBeDefined();
    expect(getSimulatorId).toHaveBeenCalled();
  });

  it('does not try to discover the physical device when the dependency is missing', async () => {
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
      getApplePhysicalDevicePlatformInstance(config)
    ).rejects.toThrow('missing');
    expect(getDeviceId).not.toHaveBeenCalled();
  });
});
