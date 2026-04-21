import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import * as simctl from '../xcrun/simctl.js';
import * as devicectl from '../xcrun/devicectl.js';

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(async () => undefined),
  ensureStarted: vi.fn(async () => undefined),
  prepare: vi.fn(async () => undefined),
  createXCTestAgentController: vi.fn(),
}));

vi.mock('../xctest-agent.js', () => ({
  createXCTestAgentController: mocks.createXCTestAgentController,
}));

import {
  getApplePhysicalDevicePlatformInstance,
  getAppleSimulatorPlatformInstance,
} from '../instance.js';

const harnessConfig = {
  metroPort: DEFAULT_METRO_PORT,
} as HarnessConfig;

describe('iOS XCTest agent runner integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createXCTestAgentController.mockReturnValue({
      prepare: mocks.prepare,
      ensureStarted: mocks.ensureStarted,
      stop: vi.fn(async () => undefined),
      dispose: mocks.dispose,
    });
  });

  it('prepares and lazily starts the simulator XCTest agent', async () => {
    vi.spyOn(simctl, 'getSimulatorId').mockResolvedValue('sim-udid');
    vi.spyOn(simctl, 'isAppInstalled').mockResolvedValue(true);
    vi.spyOn(simctl, 'getSimulatorStatus').mockResolvedValue('Booted');
    vi.spyOn(simctl, 'applyHarnessJsLocationOverride').mockResolvedValue(
      undefined,
    );
    vi.spyOn(simctl, 'startApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'stopApp').mockResolvedValue(undefined);
    vi.spyOn(simctl, 'clearHarnessJsLocationOverride').mockResolvedValue(
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
      harnessConfig,
      {
        signal: new AbortController().signal,
      },
    );

    await instance.prepareRun?.();
    await instance.startApp();
    await instance.disposeRun?.();

    expect(mocks.createXCTestAgentController).toHaveBeenCalledWith({
      target: {
        kind: 'simulator',
        id: 'sim-udid',
      },
    });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.ensureStarted).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('prepares and lazily starts the physical-device XCTest agent', async () => {
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
    vi.spyOn(devicectl, 'startApp').mockResolvedValue(undefined);
    vi.spyOn(devicectl, 'stopApp').mockResolvedValue(undefined);

    const instance = await getApplePhysicalDevicePlatformInstance(
      {
        name: 'ios-device',
        device: {
          type: 'physical',
          name: 'My iPhone',
        },
        bundleId: 'com.harnessplayground',
      },
      harnessConfig,
    );

    await instance.prepareRun?.();
    await instance.restartApp();
    await instance.disposeRun?.();

    expect(mocks.createXCTestAgentController).toHaveBeenCalledWith({
      target: {
        kind: 'device',
        id: 'device-udid',
      },
    });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.ensureStarted).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
});
