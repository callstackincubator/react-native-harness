import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  getHostCapabilities: vi.fn(),
}));

vi.mock('@react-native-harness/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-native-harness/tools')>()),
  spawn: mocks.spawn,
  getHostCapabilities: mocks.getHostCapabilities,
}));

import {
  prepareCiSimulator,
  resolveCiSimulatorSlim,
  SIMULATOR_QUIET_LOG_SUBSYSTEMS,
  SIMULATOR_SLIM_LABELS,
  slimSimulator,
} from '../simulator-slim.js';

const SMALL_HOST = { totalMemoryBytes: 7 * 1024 ** 3, availableCpuCount: 3 };
const LARGE_HOST = { totalMemoryBytes: 32 * 1024 ** 3, availableCpuCount: 12 };

const simulatorList = (state: string) =>
  JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-26-4': [
        { name: 'iPhone 17 Pro', udid: 'SIM-1', state, isAvailable: true },
      ],
    },
  });

describe('resolveCiSimulatorSlim', () => {
  it.each([
    ['auto', true, SMALL_HOST, true],
    [undefined, true, SMALL_HOST, true],
    ['auto', false, SMALL_HOST, false],
    ['auto', true, LARGE_HOST, false],
    ['true', false, LARGE_HOST, true],
    ['false', true, SMALL_HOST, false],
  ])(
    'mode %s on github-hosted=%s resolves to %s',
    (mode, githubHosted, host, expected) => {
      mocks.getHostCapabilities.mockReturnValue(host);
      expect(resolveCiSimulatorSlim(mode, { githubHosted })).toBe(expected);
    }
  );
});

describe('slimSimulator', () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
  });

  it('disables and boots out every service and quiets every subsystem', async () => {
    mocks.spawn.mockResolvedValue({ stdout: '' });

    const result = await slimSimulator('SIM-1');

    expect(result.stopped).toHaveLength(SIMULATOR_SLIM_LABELS.length);
    expect(result.quieted).toHaveLength(SIMULATOR_QUIET_LOG_SUBSYSTEMS.length);
    expect(result.skipped).toEqual([]);
    expect(mocks.spawn).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'spawn', 'SIM-1', 'launchctl', 'disable', 'system/com.apple.mediaanalysisd'],
      expect.anything()
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'spawn', 'SIM-1', 'launchctl', 'bootout', 'system/com.apple.mediaanalysisd'],
      expect.anything()
    );
  });

  it('skips a service whose disable fails and still counts one whose bootout fails', async () => {
    mocks.spawn.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('disable') && args.includes('system/com.apple.chronod')) {
        throw new Error('no such service');
      }
      if (args.includes('bootout')) {
        throw new Error('not running');
      }
      return { stdout: '' };
    });

    const result = await slimSimulator('SIM-1', { parallelism: 2 });

    expect(result.skipped).toEqual(['com.apple.chronod']);
    expect(result.stopped).toHaveLength(SIMULATOR_SLIM_LABELS.length - 1);
  });
});

describe('prepareCiSimulator', () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
  });

  it('boots a shut-down simulator before slimming it', async () => {
    mocks.spawn.mockImplementation(async (_cmd: string, args: string[]) =>
      args[1] === 'list' ? { stdout: simulatorList('Shutdown') } : { stdout: '' }
    );

    const result = await prepareCiSimulator({
      name: 'iPhone 17 Pro',
      systemVersion: '26.4',
    });

    expect(result).toMatchObject({ status: 'prepared', udid: 'SIM-1', bootedNow: true });
    expect(mocks.spawn).toHaveBeenCalledWith('xcrun', ['simctl', 'boot', 'SIM-1']);
  });

  it('slims an already booted simulator without booting it again', async () => {
    mocks.spawn.mockImplementation(async (_cmd: string, args: string[]) =>
      args[1] === 'list' ? { stdout: simulatorList('Booted') } : { stdout: '' }
    );

    const result = await prepareCiSimulator({
      name: 'iPhone 17 Pro',
      systemVersion: '26.4',
    });

    expect(result).toMatchObject({ status: 'prepared', bootedNow: false });
    expect(mocks.spawn).not.toHaveBeenCalledWith('xcrun', ['simctl', 'boot', 'SIM-1']);
  });

  it('reports a missing simulator', async () => {
    mocks.spawn.mockResolvedValue({ stdout: JSON.stringify({ devices: {} }) });

    await expect(
      prepareCiSimulator({ name: 'iPhone 17 Pro', systemVersion: '26.4' })
    ).resolves.toEqual({ status: 'not-found' });
  });
});
