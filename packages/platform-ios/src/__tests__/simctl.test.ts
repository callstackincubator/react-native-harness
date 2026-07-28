import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as tools from '@react-native-harness/tools';
import {
  applyLowMemoryProfile,
  diagnose,
  streamLogs,
  waitForBoot,
} from '../xcrun/simctl.js';

const LOW_MEMORY_DISABLED_DAEMON_LABELS = [
  'com.apple.duetexpertd',
  'com.apple.proactiveeventtrackerd',
  'com.apple.triald',
  'com.apple.knowledge-agent',
  'com.apple.suggestd',
  'com.apple.parsecd',
  'com.apple.spotlightknowledged',
  'com.apple.corespotlightd',
  'com.apple.photoanalysisd',
  'com.apple.mediaanalysisd',
  'com.apple.followupd',
  'com.apple.familycircled',
  'com.apple.icloud.searchpartyd',
  'com.apple.newsd',
  'com.apple.tipsd',
];

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

  it('starts simulator log streaming with the provided predicate', () => {
    const subprocess = {} as ReturnType<typeof tools.spawn>;
    const spawnSpy = vi.spyOn(tools, 'spawn').mockReturnValue(subprocess);

    expect(
      streamLogs(
        'sim-udid',
        'process == "HarnessPlayground" OR process == "com.harnessplayground"'
      )
    ).toBe(subprocess);

    expect(spawnSpy).toHaveBeenCalledWith(
      'xcrun',
      [
        'simctl',
        'spawn',
        'sim-udid',
        'log',
        'stream',
        '--style',
        'compact',
        '--level',
        'info',
        '--predicate',
        'process == "HarnessPlayground" OR process == "com.harnessplayground"',
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
  });
});

describe('applyLowMemoryProfile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('disables and boots out every expected daemon label, disable before bootout', async () => {
    const calls: Array<[string, readonly string[] | undefined]> = [];
    const spawnAndForgetSpy = vi
      .spyOn(tools, 'spawnAndForget')
      .mockImplementation(async (file, args) => {
        calls.push([file, args]);
      });

    await applyLowMemoryProfile('sim-udid');

    expect(spawnAndForgetSpy).toHaveBeenCalledTimes(
      LOW_MEMORY_DISABLED_DAEMON_LABELS.length * 2,
    );

    for (const label of LOW_MEMORY_DISABLED_DAEMON_LABELS) {
      expect(spawnAndForgetSpy).toHaveBeenCalledWith('xcrun', [
        'simctl',
        'spawn',
        'sim-udid',
        'launchctl',
        'disable',
        `system/${label}`,
      ]);
      expect(spawnAndForgetSpy).toHaveBeenCalledWith('xcrun', [
        'simctl',
        'spawn',
        'sim-udid',
        'launchctl',
        'bootout',
        `system/${label}`,
      ]);

      // disable must be issued before bootout for the same label, so a
      // service torn down by bootout cannot be relaunched on demand before
      // it is disabled.
      const disableIndex = calls.findIndex(
        ([, callArgs]) => callArgs?.[4] === 'disable' && callArgs[5] === `system/${label}`,
      );
      const bootoutIndex = calls.findIndex(
        ([, callArgs]) => callArgs?.[4] === 'bootout' && callArgs[5] === `system/${label}`,
      );
      expect(disableIndex).toBeGreaterThanOrEqual(0);
      expect(bootoutIndex).toBeGreaterThan(disableIndex);
    }

    // These must never be disabled or booted out: the harness relies on
    // them for crash detection.
    expect(spawnAndForgetSpy).not.toHaveBeenCalledWith(
      'xcrun',
      expect.arrayContaining(['system/com.apple.analyticsd']),
    );
    expect(spawnAndForgetSpy).not.toHaveBeenCalledWith(
      'xcrun',
      expect.arrayContaining([
        'system/com.apple.osanalytics.osanalyticshelper',
      ]),
    );
  });

  it('tolerates a failing disable or bootout without aborting the rest of the profile', async () => {
    // applyLowMemoryProfile relies on spawnAndForget itself swallowing
    // failures (as it does for every other best-effort simctl call in this
    // file), so a rejection here must not propagate or stop the other calls.
    // bootout in particular is expected to legitimately fail for labels that
    // were never running.
    const spawnAndForgetSpy = vi
      .spyOn(tools, 'spawnAndForget')
      .mockImplementation(async (_file, args) => {
        const label = args?.[args.length - 1];
        const action = args?.[args.length - 2];
        if (label === 'system/com.apple.triald' && action === 'disable') {
          throw new Error('label not found on this runtime');
        }
        if (label === 'system/com.apple.suggestd' && action === 'bootout') {
          throw new Error('service not running');
        }
      });

    await expect(applyLowMemoryProfile('sim-udid')).resolves.toBeUndefined();

    expect(spawnAndForgetSpy).toHaveBeenCalledTimes(
      LOW_MEMORY_DISABLED_DAEMON_LABELS.length * 2 - 1,
    );

    // The disable failure for triald must not prevent bootout from being
    // attempted for every *other* label.
    for (const label of LOW_MEMORY_DISABLED_DAEMON_LABELS) {
      if (label === 'com.apple.triald') {
        continue;
      }
      expect(spawnAndForgetSpy).toHaveBeenCalledWith('xcrun', [
        'simctl',
        'spawn',
        'sim-udid',
        'launchctl',
        'bootout',
        `system/${label}`,
      ]);
    }
  });
});
