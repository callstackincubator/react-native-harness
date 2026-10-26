import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('@react-native-harness/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-native-harness/tools')>()),
  spawn: mocks.spawn,
}));

import {
  SIMULATOR_QUIET_LOG_SUBSYSTEMS,
  SIMULATOR_SLIM_LABELS,
  slimSimulator,
} from '../simulator-slim.js';

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

  it('makes no further calls once the signal aborts', async () => {
    const controller = new AbortController();
    mocks.spawn.mockImplementation(async () => {
      controller.abort();
      return { stdout: '' };
    });

    const result = await slimSimulator('SIM-1', {
      parallelism: 1,
      signal: controller.signal,
    });

    expect(result.timedOut).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });
});
