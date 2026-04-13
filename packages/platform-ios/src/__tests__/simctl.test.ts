import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as tools from '@react-native-harness/tools';
import { diagnose, waitForBoot } from '../xcrun/simctl.js';

describe('simctl startup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the abort signal to simctl bootstatus', async () => {
    const signal = new AbortController().signal;
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValue({} as Awaited<ReturnType<typeof tools.spawn>>);

    await waitForBoot('sim-udid', signal);

    expect(spawnSpy).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'bootstatus', 'sim-udid', '-b'],
      { signal },
    );
  });

  it('runs simctl diagnose into the provided directory', async () => {
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValue({} as Awaited<ReturnType<typeof tools.spawn>>);

    await diagnose('sim-udid', '/tmp/sim-diagnose-output');

    expect(spawnSpy).toHaveBeenCalledWith(
      'xcrun',
      [
        'simctl',
        'diagnose',
        '--udid=sim-udid',
        '--no-archive',
        '--output=/tmp/sim-diagnose-output',
        '-b',
      ],
      {
        stdin: { string: '\n' },
      },
    );
  });
});
