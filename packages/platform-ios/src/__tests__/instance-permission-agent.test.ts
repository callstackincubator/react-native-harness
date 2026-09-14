import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import * as simctl from '../xcrun/simctl.js';
import * as devicectl from '../xcrun/devicectl.js';

const mocks = vi.hoisted(() => ({
  createIosPermissionAgent: vi.fn(),
  dispose: vi.fn(async () => undefined),
  prepare: vi.fn(async () => undefined),
  setAppRunning: vi.fn(),
}));

const appSessionMocks = vi.hoisted(() => ({
  createIosAppSession: vi.fn(),
}));

vi.mock('../permission-agent.js', () => ({
  createIosPermissionAgent: mocks.createIosPermissionAgent,
}));

vi.mock('../app-session.js', () => ({
  createIosAppSession: appSessionMocks.createIosAppSession,
}));

const {
  getApplePhysicalDevicePlatformInstance,
  getAppleSimulatorPlatformInstance,
} = await import('../instance.js');

const harnessConfig = {
  metroPort: DEFAULT_METRO_PORT,
} as HarnessConfig;
const harnessConfigWithPermissionsEnabled = {
  metroPort: DEFAULT_METRO_PORT,
  permissions: true,
} as HarnessConfig;

const simulatorConfig = {
  name: 'ios',
  device: {
    type: 'simulator' as const,
    name: 'iPhone 16 Pro',
    systemVersion: '18.0',
  },
  bundleId: 'com.harnessplayground',
};

const physicalDevice = {
  identifier: 'physical-device-id',
  deviceProperties: {
    name: 'My iPhone',
    osVersionNumber: '18.0',
  },
  hardwareProperties: {
    marketingName: 'iPhone',
    productType: 'iPhone17,1',
    udid: 'device-udid',
  },
};

describe('iOS permission agent runner integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appSessionMocks.createIosAppSession.mockResolvedValue({
      dispose: async () => undefined,
    });
    mocks.prepare.mockResolvedValue(undefined);
    mocks.createIosPermissionAgent.mockReturnValue({
      prepare: mocks.prepare,
      setAppRunning: mocks.setAppRunning,
      dispose: mocks.dispose,
    });
  });

  it('prepares the runner only after the simulator is booted and the app installed', async () => {
    const getSimulatorStatus = vi
      .spyOn(simctl, 'getSimulatorStatus')
      .mockResolvedValue('Shutdown');
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    const bootSimulator = vi
      .spyOn(simctl, 'bootSimulator')
      .mockResolvedValue(undefined);
    vi.spyOn(simctl, 'waitForBoot').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    const applyOverride = vi
      .spyOn(simctl, 'applyHarnessJsLocationOverride')
      .mockResolvedValue(undefined);
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    vi.spyOn(simctl, 'shutdownSimulator').mockResolvedValue(undefined);

    const initSignal = new AbortController().signal;
    const instance = await getAppleSimulatorPlatformInstance(
      simulatorConfig,
      harnessConfigWithPermissionsEnabled,
      { signal: initSignal }
    );

    expect(mocks.createIosPermissionAgent).toHaveBeenCalledWith({
      appBundleId: 'com.harnessplayground',
      target: { kind: 'simulator', udid: 'sim-udid' },
    });
    expect(getSimulatorStatus).toHaveBeenCalledBefore(mocks.prepare);
    expect(bootSimulator).toHaveBeenCalledBefore(mocks.prepare);
    expect(applyOverride).toHaveBeenCalledBefore(mocks.prepare);
    expect(mocks.prepare).toHaveBeenCalledWith(initSignal);

    await instance.dispose();

    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('wires the app session run state into the permission watchdog', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    vi.spyOn(simctl, 'getAppInfo').mockResolvedValue(null);
    vi.spyOn(simctl, 'isAppRunning').mockResolvedValue(true);

    const instance = await getAppleSimulatorPlatformInstance(
      simulatorConfig,
      harnessConfigWithPermissionsEnabled,
      { signal: new AbortController().signal }
    );

    await instance.createAppSession();

    const [sessionOptions] = appSessionMocks.createIosAppSession.mock
      .calls[0] as [{ onAppRunningChange?: (running: boolean) => void }];

    sessionOptions.onAppRunningChange?.(true);
    expect(mocks.setAppRunning).toHaveBeenCalledWith(true);

    sessionOptions.onAppRunningChange?.(false);
    expect(mocks.setAppRunning).toHaveBeenLastCalledWith(false);

    await instance.dispose();
  });

  it('cleans up the simulator when preparing the runner fails', async () => {
    const prepareError = new Error('runner unavailable');
    mocks.prepare.mockRejectedValue(prepareError);
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Shutdown');
    vi.spyOn(simctl, 'bootSimulator').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'waitForBoot').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );
    const clearOverride = vi
      .spyOn(simctl, 'clearHarnessJsLocationOverride')
      .mockResolvedValue(undefined);
    const shutdownSimulator = vi
      .spyOn(simctl, 'shutdownSimulator')
      .mockResolvedValue(undefined);

    await expect(
      getAppleSimulatorPlatformInstance(
        simulatorConfig,
        harnessConfigWithPermissionsEnabled,
        { signal: new AbortController().signal }
      )
    ).rejects.toThrow(prepareError);

    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(clearOverride).toHaveBeenCalledWith(
      'sim-udid',
      'com.harnessplayground'
    );
    expect(shutdownSimulator).toHaveBeenCalledWith('sim-udid');
  });

  it('passes physical-device code signing through to the permission agent', async () => {
    vi.spyOn(devicectl, 'getDevice').mockResolvedValue(physicalDevice);
    vi.spyOn(devicectl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(devicectl, 'stopApp').mockResolvedValue(undefined);

    const instance = await getApplePhysicalDevicePlatformInstance(
      {
        name: 'ios-device',
        device: {
          type: 'physical',
          name: 'My iPhone',
          codeSign: {
            teamId: 'TEAMID1234',
            runnerBundleId: 'com.example.runner',
          },
        },
        bundleId: 'com.harnessplayground',
      },
      harnessConfigWithPermissionsEnabled
    );

    expect(mocks.createIosPermissionAgent).toHaveBeenCalledWith({
      appBundleId: 'com.harnessplayground',
      target: {
        kind: 'device',
        udid: 'device-udid',
        codeSign: {
          teamId: 'TEAMID1234',
          runnerBundleId: 'com.example.runner',
        },
      },
    });

    await instance.dispose();

    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('skips physical-device permission automation without codeSign', async () => {
    vi.spyOn(devicectl, 'getDevice').mockResolvedValue(physicalDevice);
    vi.spyOn(devicectl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(devicectl, 'stopApp').mockResolvedValue(undefined);

    await getApplePhysicalDevicePlatformInstance(
      {
        name: 'ios-device',
        device: { type: 'physical', name: 'My iPhone' },
        bundleId: 'com.harnessplayground',
      },
      harnessConfigWithPermissionsEnabled
    );

    expect(mocks.createIosPermissionAgent).not.toHaveBeenCalled();
  });

  it('does not create a permission agent when permissions are disabled', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined
    );

    await getAppleSimulatorPlatformInstance(simulatorConfig, harnessConfig, {
      signal: new AbortController().signal,
    });

    expect(mocks.createIosPermissionAgent).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
