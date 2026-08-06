import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import * as simctl from '../xcrun/simctl.js';
import * as devicectl from '../xcrun/devicectl.js';
import { logger } from '@react-native-harness/tools';

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(async () => undefined),
  ensureStarted: vi.fn(async () => undefined),
  prepare: vi.fn(async () => undefined),
  createXCTestAgentController: vi.fn(),
}));
const startupStrategyMocks = vi.hoisted(() => ({
  shouldOverlapXCTestBuildAndSimulatorBoot: vi.fn(),
}));

vi.mock('../xctest-agent.js', () => ({
  createXCTestAgentController: mocks.createXCTestAgentController,
}));
vi.mock('../startup-strategy.js', () => ({
  shouldOverlapXCTestBuildAndSimulatorBoot:
    startupStrategyMocks.shouldOverlapXCTestBuildAndSimulatorBoot,
}));

import {
  getApplePhysicalDevicePlatformInstance,
  getAppleSimulatorPlatformInstance,
} from '../instance.js';

const harnessConfig = {
  metroPort: DEFAULT_METRO_PORT,
} as HarnessConfig;
const harnessConfigWithPermissionsEnabled = {
  metroPort: DEFAULT_METRO_PORT,
  permissions: true,
} as HarnessConfig;

describe('iOS XCTest agent runner integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue(undefined);
    startupStrategyMocks.shouldOverlapXCTestBuildAndSimulatorBoot.mockReturnValue(
      false,
    );
    mocks.createXCTestAgentController.mockReturnValue({
      prepare: mocks.prepare,
      ensureStarted: mocks.ensureStarted,
      stop: vi.fn(async () => undefined),
      dispose: mocks.dispose,
    });
  });

  it('starts the simulator XCTest agent during platform initialization when permissions are enabled', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );

    const initSignal = new AbortController().signal;
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
      {
        signal: initSignal,
      },
    );

    await instance.dispose();

    expect(mocks.createXCTestAgentController).toHaveBeenCalledWith({
      appBundleId: 'com.harnessplayground',
      capabilities: [
        expect.objectContaining({
          getLaunchEnvironment: expect.any(Function),
        }),
      ],
      target: {
        kind: 'simulator',
        id: 'sim-udid',
      },
    });
    expect(mocks.prepare).toHaveBeenCalledWith(initSignal);
    expect(mocks.ensureStarted).toHaveBeenCalledWith(initSignal);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('starts the physical-device XCTest agent during platform initialization when permissions are enabled', async () => {
    vi.spyOn(devicectl, 'getDevice').mockResolvedValue({
      identifier: 'device-udid',
      deviceProperties: {
        name: 'My iPhone',
        osVersionNumber: '18.0',
      },
      hardwareProperties: {
        marketingName: 'iPhone',
        productType: 'iPhone17,1',
        udid: 'device-udid',
      },
    });
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
          },
        },
        bundleId: 'com.harnessplayground',
      },
      harnessConfigWithPermissionsEnabled,
    );

    await instance.dispose();

    expect(mocks.createXCTestAgentController).toHaveBeenCalledWith({
      appBundleId: 'com.harnessplayground',
      capabilities: [
        expect.objectContaining({
          getLaunchEnvironment: expect.any(Function),
        }),
      ],
      target: {
        kind: 'device',
        id: 'device-udid',
        codeSign: {
          teamId: 'TEAMID1234',
        },
      },
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.ensureStarted).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
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
      {
        signal: new AbortController().signal,
      },
    );

    expect(mocks.createXCTestAgentController).not.toHaveBeenCalled();
    expect(mocks.ensureStarted).not.toHaveBeenCalled();
  });

  it('builds the XCTest agent before simulator preparation in sequential mode', async () => {
    let resolvePreparation: ((value: undefined) => void) | undefined;
    mocks.prepare.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolvePreparation = resolve;
        }),
    );
    const getSimulatorStatus = vi
      .spyOn(simctl, 'getSimulatorStatus')
      .mockResolvedValue('Booted');
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );

    const instancePromise = getAppleSimulatorPlatformInstance(
      simulatorConfig,
      harnessConfigWithPermissionsEnabled,
      { signal: new AbortController().signal },
    );

    await Promise.resolve();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(getSimulatorStatus).not.toHaveBeenCalled();

    resolvePreparation?.(undefined);
    const instance = await instancePromise;

    expect(mocks.prepare).toHaveBeenCalledBefore(getSimulatorStatus);
    expect(mocks.prepare).toHaveBeenCalledBefore(mocks.ensureStarted);
    await instance.dispose();
  });

  it('overlaps simulator preparation with the XCTest build in parallel mode', async () => {
    startupStrategyMocks.shouldOverlapXCTestBuildAndSimulatorBoot.mockReturnValue(
      true,
    );
    let resolvePreparation: ((value: undefined) => void) | undefined;
    mocks.prepare.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolvePreparation = resolve;
        }),
    );
    const getSimulatorStatus = vi
      .spyOn(simctl, 'getSimulatorStatus')
      .mockResolvedValue('Booted');
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );

    const instancePromise = getAppleSimulatorPlatformInstance(
      simulatorConfig,
      harnessConfigWithPermissionsEnabled,
      { signal: new AbortController().signal },
    );

    await Promise.resolve();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(getSimulatorStatus).toHaveBeenCalledTimes(1);

    resolvePreparation?.(undefined);
    const instance = await instancePromise;

    expect(mocks.prepare).toHaveBeenCalledBefore(mocks.ensureStarted);
    await instance.dispose();
  });

  it('logs the selected XCTest startup strategy at debug level', async () => {
    const wasVerbose = logger.isVerbose();
    logger.setVerbose(true);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );

    try {
      const instance = await getAppleSimulatorPlatformInstance(
        simulatorConfig,
        harnessConfigWithPermissionsEnabled,
        { signal: new AbortController().signal },
      );

      expect(debug).toHaveBeenCalledWith(
        expect.stringContaining('selected sequential XCTest build'),
      );
      await instance.dispose();
    } finally {
      logger.setVerbose(wasVerbose);
      debug.mockRestore();
    }
  });

  it('cleans up after a sequential XCTest build failure', async () => {
    const buildError = new Error('build failed');
    mocks.prepare.mockRejectedValue(buildError);
    const getSimulatorStatus = vi.spyOn(simctl, 'getSimulatorStatus');
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');

    await expect(
      getAppleSimulatorPlatformInstance(
        simulatorConfig,
        harnessConfigWithPermissionsEnabled,
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow(buildError);

    expect(getSimulatorStatus).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('waits for and cleans up a parallel XCTest build when simulator preparation fails', async () => {
    startupStrategyMocks.shouldOverlapXCTestBuildAndSimulatorBoot.mockReturnValue(
      true,
    );
    let resolvePreparation: ((value: undefined) => void) | undefined;
    mocks.prepare.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolvePreparation = resolve;
        }),
    );
    const simulatorError = new Error('simulator failed');
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Creating');
    vi.spyOn(simctl, 'bootSimulator').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'waitForBoot').mockRejectedValue(simulatorError);
    const shutdownSimulator = vi
      .spyOn(simctl, 'shutdownSimulator')
      .mockResolvedValue(undefined);

    const instancePromise = getAppleSimulatorPlatformInstance(
      simulatorConfig,
      harnessConfigWithPermissionsEnabled,
      { signal: new AbortController().signal },
    );

    await Promise.resolve();
    expect(shutdownSimulator).not.toHaveBeenCalled();
    resolvePreparation?.(undefined);

    await expect(instancePromise).rejects.toThrow(simulatorError);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(shutdownSimulator).toHaveBeenCalledWith('sim-udid');
  });

  it('propagates a parallel XCTest build failure and cleans up simulator preparation', async () => {
    startupStrategyMocks.shouldOverlapXCTestBuildAndSimulatorBoot.mockReturnValue(
      true,
    );
    const buildError = new Error('build failed');
    mocks.prepare.mockRejectedValue(buildError);
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );
    const clearHarnessJsLocationOverride = vi
      .spyOn(simctl, 'clearHarnessJsLocationOverride')
      .mockResolvedValue(undefined);

    await expect(
      getAppleSimulatorPlatformInstance(
        simulatorConfig,
        harnessConfigWithPermissionsEnabled,
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow(buildError);

    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(clearHarnessJsLocationOverride).toHaveBeenCalledWith(
      'sim-udid',
      'com.harnessplayground',
    );
  });
});

const simulatorConfig = {
  name: 'ios',
  device: {
    type: 'simulator' as const,
    name: 'iPhone 16 Pro',
    systemVersion: '18.0',
  },
  bundleId: 'com.harnessplayground',
};
