import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import * as simctl from '../xcrun/simctl.js';

// Deliberately NOT mocking '../permission-agent.js': this asserts that the
// real module never reaches agent-device when permissions are off, which a
// wholesale mock of the agent would hide.
const mocks = vi.hoisted(() => ({
  createAgentDeviceClient: vi.fn(),
  runCommand: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

vi.mock('agent-device', () => ({
  createAgentDeviceClient: mocks.createAgentDeviceClient,
}));

// Keeps teardown from shelling out to the real agent-device CLI.
vi.mock('@react-native-harness/tools', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@react-native-harness/tools')>();

  return { ...actual, runCommand: mocks.runCommand };
});

const { getAppleSimulatorPlatformInstance } = await import('../instance.js');

const simulatorConfig = {
  name: 'ios',
  device: {
    type: 'simulator' as const,
    name: 'iPhone 16 Pro',
    systemVersion: '18.0',
  },
  bundleId: 'com.harnessplayground',
};

describe('iOS permission automation opt-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it('never creates an agent-device client when permissions are disabled', async () => {
    const instance = await getAppleSimulatorPlatformInstance(
      simulatorConfig,
      { metroPort: DEFAULT_METRO_PORT } as HarnessConfig,
      { signal: new AbortController().signal }
    );

    await instance.dispose();

    expect(mocks.createAgentDeviceClient).not.toHaveBeenCalled();
  });

  it('creates an agent-device client when permissions are enabled', async () => {
    mocks.createAgentDeviceClient.mockReturnValue({
      command: { alert: vi.fn(), prepare: vi.fn(async () => ({})) },
      apps: { open: vi.fn(async () => ({})) },
      sessions: { close: vi.fn(async () => ({})) },
      interactions: { press: vi.fn() },
    });

    const instance = await getAppleSimulatorPlatformInstance(
      simulatorConfig,
      { metroPort: DEFAULT_METRO_PORT, permissions: true } as HarnessConfig,
      { signal: new AbortController().signal }
    );

    expect(mocks.createAgentDeviceClient).toHaveBeenCalledTimes(1);

    await instance.dispose();
  });
});
