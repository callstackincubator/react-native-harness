import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import * as tools from '@react-native-harness/tools';
import {
  getApplePhysicalDevicePlatformInstance,
  getAppleSimulatorPlatformInstance,
} from '../instance.js';
import * as simctl from '../xcrun/simctl.js';
import * as devicectl from '../xcrun/devicectl.js';
import { HarnessAppPathError } from '../errors.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const xctestAgentMocks = vi.hoisted(() => ({
  createXCTestAgentController: vi.fn(),
  dispose: vi.fn(async () => undefined),
  ensureStarted: vi.fn(async () => undefined),
  prepare: vi.fn(async () => undefined),
}));

vi.mock('../xctest-agent.js', () => ({
  createXCTestAgentController: xctestAgentMocks.createXCTestAgentController,
}));

const harnessConfig = {
  metroPort: DEFAULT_METRO_PORT,
} as HarnessConfig;
const harnessConfigWithPermissionsEnabled = {
  metroPort: DEFAULT_METRO_PORT,
  permissions: true,
} as HarnessConfig;
const init = {
  signal: new AbortController().signal,
};

const harnessConfigWithoutNativeCrashDetection = {
  metroPort: DEFAULT_METRO_PORT,
  detectNativeCrashes: false,
} as HarnessConfig;

describe('iOS platform instance dependency validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // Default to a high-memory host so existing behaviour is exercised
    // unless a test explicitly opts into the low-memory profile.
    vi.spyOn(tools, 'isLowMemoryHost').mockReturnValue(false);
    xctestAgentMocks.createXCTestAgentController.mockReturnValue({
      prepare: xctestAgentMocks.prepare,
      ensureStarted: xctestAgentMocks.ensureStarted,
      stop: vi.fn(async () => undefined),
      dispose: xctestAgentMocks.dispose,
    });
  });

  it('does not require extra dependencies before creating a simulator instance', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
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
      getAppleSimulatorPlatformInstance(config, harnessConfig, init),
    ).resolves.toBeDefined();
  });

  it('does not start the simulator XCTest agent when permissions are disabled', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );

    await getAppleSimulatorPlatformInstance(
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
      init,
    );

    expect(xctestAgentMocks.createXCTestAgentController).not.toHaveBeenCalled();
  });

  it('discovers the physical device directly through devicectl', async () => {
    const getDevice = vi.spyOn(devicectl, 'getDevice').mockResolvedValue({
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
      getApplePhysicalDevicePlatformInstance(config, harnessConfig),
    ).resolves.toBeDefined();
    expect(getDevice).toHaveBeenCalledWith('My iPhone');
  });

  it('does not start the physical-device XCTest agent when permissions are disabled', async () => {
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

    await getApplePhysicalDevicePlatformInstance(
      {
        name: 'ios-device',
        device: {
          type: 'physical',
          name: 'My iPhone',
          codeSign: { teamId: 'TESTTEAM01' },
        },
        bundleId: 'com.harnessplayground',
      },
      harnessConfig,
    );

    expect(xctestAgentMocks.createXCTestAgentController).not.toHaveBeenCalled();
  });

  it('skips physical crash monitoring setup when native crash detection is disabled', async () => {
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
        harnessConfigWithoutNativeCrashDetection,
      ),
    ).resolves.toBeDefined();
  });

  it('exposes simulator app sessions when native crash detection is disabled', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );

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
      harnessConfigWithoutNativeCrashDetection,
      init,
    );

    expect(instance.createAppSession).toEqual(expect.any(Function));
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
      harnessConfigWithPermissionsEnabled,
      init,
    );

    expect(applyOverride).toHaveBeenCalledWith(
      'sim-udid',
      'com.harnessplayground',
      'localhost:8081',
    );

    await instance.dispose();

    expect(stopApp).toHaveBeenCalledWith('sim-udid', 'com.harnessplayground');
    expect(clearOverride).toHaveBeenCalledWith(
      'sim-udid',
      'com.harnessplayground',
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
      undefined,
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined,
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
      init,
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
      undefined,
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined,
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
      init,
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
      undefined,
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined,
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
      init,
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
      undefined,
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
          init,
        ),
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
        init,
      ),
    ).rejects.toBeInstanceOf(HarnessAppPathError);
  });

  it('does not apply the low-memory profile or an extra boot cycle on a high-memory host', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Shutdown');
    const bootSimulator = vi
      .spyOn(simctl, 'bootSimulator')
      .mockResolvedValue(undefined);
    const waitForBoot = vi
      .spyOn(simctl, 'waitForBoot')
      .mockResolvedValue(undefined);
    const applyLowMemoryProfile = vi
      .spyOn(simctl, 'applyLowMemoryProfile')
      .mockResolvedValue(undefined);
    const shutdownSimulator = vi
      .spyOn(simctl, 'shutdownSimulator')
      .mockResolvedValue(undefined);
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );

    await getAppleSimulatorPlatformInstance(
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
      init,
    );

    expect(applyLowMemoryProfile).not.toHaveBeenCalled();
    expect(bootSimulator).toHaveBeenCalledTimes(1);
    expect(waitForBoot).toHaveBeenCalledTimes(1);
    // shutdownSimulator is only expected on dispose, not during setup.
    expect(shutdownSimulator).not.toHaveBeenCalled();
  });

  it('applies the low-memory profile and cycles the boot when starting a shutdown simulator on a low-memory host', async () => {
    vi.spyOn(tools, 'isLowMemoryHost').mockReturnValue(true);
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Shutdown');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );

    const calls: string[] = [];
    const bootSimulator = vi
      .spyOn(simctl, 'bootSimulator')
      .mockImplementation(async () => {
        calls.push('boot');
      });
    const waitForBoot = vi
      .spyOn(simctl, 'waitForBoot')
      .mockImplementation(async () => {
        calls.push('waitForBoot');
      });
    const applyLowMemoryProfile = vi
      .spyOn(simctl, 'applyLowMemoryProfile')
      .mockImplementation(async () => {
        calls.push('applyLowMemoryProfile');
      });
    const shutdownSimulator = vi
      .spyOn(simctl, 'shutdownSimulator')
      .mockImplementation(async () => {
        calls.push('shutdown');
      });

    await getAppleSimulatorPlatformInstance(
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
      init,
    );

    expect(applyLowMemoryProfile).toHaveBeenCalledWith('sim-udid');
    expect(bootSimulator).toHaveBeenCalledTimes(2);
    expect(waitForBoot).toHaveBeenCalledTimes(2);
    expect(shutdownSimulator).toHaveBeenCalledTimes(1);

    // The profile only takes effect on daemons that haven't started yet, so
    // it must be applied after the first boot completes and be followed by
    // a shutdown + reboot cycle before the app is installed/launched.
    expect(calls).toEqual([
      'boot',
      'waitForBoot',
      'applyLowMemoryProfile',
      'shutdown',
      'boot',
      'waitForBoot',
    ]);
  });

  it('does not apply the low-memory profile to a simulator that was already booted, even on a low-memory host', async () => {
    vi.spyOn(tools, 'isLowMemoryHost').mockReturnValue(true);
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );
    const bootSimulator = vi
      .spyOn(simctl, 'bootSimulator')
      .mockResolvedValue(undefined);
    const applyLowMemoryProfile = vi
      .spyOn(simctl, 'applyLowMemoryProfile')
      .mockResolvedValue(undefined);
    const shutdownSimulator = vi
      .spyOn(simctl, 'shutdownSimulator')
      .mockResolvedValue(undefined);

    await getAppleSimulatorPlatformInstance(
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
      init,
    );

    expect(applyLowMemoryProfile).not.toHaveBeenCalled();
    expect(bootSimulator).not.toHaveBeenCalled();
    // Never forcibly reboot a simulator the caller already had running.
    expect(shutdownSimulator).not.toHaveBeenCalled();
  });

  it('throws a HarnessAppPathError when HARNESS_APP_PATH points to a missing app', async () => {
    vi.stubEnv(
      'HARNESS_APP_PATH',
      join(tmpdir(), 'rn-harness-ios-missing-app', 'Missing.app'),
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
        init,
      ),
    ).rejects.toBeInstanceOf(HarnessAppPathError);
  });
});
