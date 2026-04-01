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
import { HarnessAppPathError } from '../errors.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const harnessConfig = {
  metroPort: DEFAULT_METRO_PORT,
} as HarnessConfig;
const init = {
  signal: new AbortController().signal,
};

describe('iOS platform instance dependency validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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
      device: {
        type: 'simulator' as const,
        name: 'iPhone 16 Pro',
        systemVersion: '18.0',
      },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getAppleSimulatorPlatformInstance(config, harnessConfig, init)
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
      getApplePhysicalDevicePlatformInstance(config, harnessConfig)
    ).rejects.toThrow('missing');
    expect(assertInstalled).toHaveBeenCalled();
  });

  it('still discovers the simulator without libimobiledevice', async () => {
    vi.spyOn(
      libimobiledevice,
      'assertLibimobiledeviceInstalled'
    ).mockResolvedValue(undefined);
    const getSimulatorId = vi
      .spyOn(simctl, 'getSimulatorId')
      .mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );

    const config = {
      name: 'ios',
      device: {
        type: 'simulator' as const,
        name: 'iPhone 16 Pro',
        systemVersion: '18.0',
      },
      bundleId: 'com.harnessplayground',
    };

    await expect(
      getAppleSimulatorPlatformInstance(config, harnessConfig, init)
    ).resolves.toBeDefined();
    expect(getSimulatorId).toHaveBeenCalled();
  });

  it('does not try to discover the physical device when the dependency is missing', async () => {
    vi.spyOn(
      libimobiledevice,
      'assertLibimobiledeviceInstalled'
    ).mockRejectedValue(new Error('missing'));
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

  it('reuses a booted simulator and does not shut it down on dispose', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    const stopApp = vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    const clearOverride = vi
      .spyOn(simctl, 'clearHarnessJsLocationOverride')
      .mockResolvedValue(undefined);
    const shutdownSimulator = vi
      .spyOn(simctl, 'shutdownSimulator')
      .mockResolvedValue(undefined);
    const applyOverride = vi
      .spyOn(simctl, 'applyHarnessJsLocationOverride')
      .mockResolvedValue(undefined);

    const instance = await getAppleSimulatorPlatformInstance(
      {
        name: 'ios',
        device: {
          type: 'simulator',
          name: 'iPhone 16 Pro',
          systemVersion: '18.0',
        },
        bundleId: 'com.harnessplayground',
      },
      harnessConfig,
      init
    );

    expect(applyOverride).toHaveBeenCalledWith(
      'sim-udid',
      'com.harnessplayground',
      'localhost:8081'
    );

    await instance.dispose();

    expect(stopApp).toHaveBeenCalledWith('sim-udid', 'com.harnessplayground');
    expect(clearOverride).toHaveBeenCalledWith(
      'sim-udid',
      'com.harnessplayground'
    );
    expect(shutdownSimulator).not.toHaveBeenCalled();
  });

  it('boots a shutdown simulator and shuts it down on dispose', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Shutdown');
    const bootSimulator = vi
      .spyOn(simctl, 'bootSimulator')
      .mockResolvedValue(undefined);
    const waitForBoot = vi
      .spyOn(simctl, 'waitForBoot')
      .mockResolvedValue(undefined);
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    const shutdownSimulator = vi
      .spyOn(simctl, 'shutdownSimulator')
      .mockResolvedValue(undefined);

    const instance = await getAppleSimulatorPlatformInstance(
      {
        name: 'ios',
        device: {
          type: 'simulator',
          name: 'iPhone 16 Pro',
          systemVersion: '18.0',
        },
        bundleId: 'com.harnessplayground',
      },
      harnessConfig,
      init
    );

    expect(bootSimulator).toHaveBeenCalledWith('sim-udid');
    expect(waitForBoot).toHaveBeenCalledWith('sim-udid', init.signal);

    await instance.dispose();

    expect(shutdownSimulator).toHaveBeenCalledWith('sim-udid');
  });

  it('waits for a simulator that is already booting', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booting');
    const bootSimulator = vi
      .spyOn(simctl, 'bootSimulator')
      .mockResolvedValue(undefined);
    const waitForBoot = vi
      .spyOn(simctl, 'waitForBoot')
      .mockResolvedValue(undefined);
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    const shutdownSimulator = vi
      .spyOn(simctl, 'shutdownSimulator')
      .mockResolvedValue(undefined);

    const instance = await getAppleSimulatorPlatformInstance(
      {
        name: 'ios',
        device: {
          type: 'simulator',
          name: 'iPhone 16 Pro',
          systemVersion: '18.0',
        },
        bundleId: 'com.harnessplayground',
      },
      harnessConfig,
      init
    );

    expect(bootSimulator).not.toHaveBeenCalled();
    expect(waitForBoot).toHaveBeenCalledWith('sim-udid', init.signal);

    await instance.dispose();

    expect(shutdownSimulator).not.toHaveBeenCalled();
  });

  it('boots and waits for other non-booted simulator states', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Creating');
    const bootSimulator = vi
      .spyOn(simctl, 'bootSimulator')
      .mockResolvedValue(undefined);
    const waitForBoot = vi
      .spyOn(simctl, 'waitForBoot')
      .mockResolvedValue(undefined);
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    const shutdownSimulator = vi
      .spyOn(simctl, 'shutdownSimulator')
      .mockResolvedValue(undefined);

    const instance = await getAppleSimulatorPlatformInstance(
      {
        name: 'ios',
        device: {
          type: 'simulator',
          name: 'iPhone 16 Pro',
          systemVersion: '18.0',
        },
        bundleId: 'com.harnessplayground',
      },
      harnessConfig,
      init
    );

    expect(bootSimulator).toHaveBeenCalledWith('sim-udid');
    expect(waitForBoot).toHaveBeenCalledWith('sim-udid', init.signal);

    await instance.dispose();

    expect(shutdownSimulator).toHaveBeenCalledWith('sim-udid');
  });

  it('installs the app from HARNESS_APP_PATH when missing', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'rn-harness-ios-app-'));
    const bundlePath = join(appDir, 'HarnessPlayground.app');
    mkdirSync(bundlePath);
    vi.stubEnv('HARNESS_APP_PATH', bundlePath);
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(false);
    const installApp = vi
      .spyOn(simctl, 'installApp')
      .mockResolvedValue(undefined);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );

    try {
      await expect(
        getAppleSimulatorPlatformInstance(
          {
            name: 'ios',
            device: {
              type: 'simulator',
              name: 'iPhone 16 Pro',
              systemVersion: '18.0',
            },
            bundleId: 'com.harnessplayground',
          },
          harnessConfig,
          init
        )
      ).resolves.toBeDefined();

      expect(installApp).toHaveBeenCalledWith('sim-udid', bundlePath);
    } finally {
      rmSync(appDir, { force: true, recursive: true });
    }
  });

  it('throws a HarnessAppPathError when HARNESS_APP_PATH is missing', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(false);

    await expect(
      getAppleSimulatorPlatformInstance(
        {
          name: 'ios',
          device: {
            type: 'simulator',
            name: 'iPhone 16 Pro',
            systemVersion: '18.0',
          },
          bundleId: 'com.harnessplayground',
        },
        harnessConfig,
        init
      )
    ).rejects.toBeInstanceOf(HarnessAppPathError);
  });

  it('throws a HarnessAppPathError when HARNESS_APP_PATH points to a missing app', async () => {
    vi.stubEnv(
      'HARNESS_APP_PATH',
      join(tmpdir(), 'rn-harness-ios-missing-app', 'Missing.app')
    );
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(false);

    await expect(
      getAppleSimulatorPlatformInstance(
        {
          name: 'ios',
          device: {
            type: 'simulator',
            name: 'iPhone 16 Pro',
            systemVersion: '18.0',
          },
          bundleId: 'com.harnessplayground',
        },
        harnessConfig,
        init
      )
    ).rejects.toBeInstanceOf(HarnessAppPathError);
  });
});
