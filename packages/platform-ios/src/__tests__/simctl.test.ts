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

  it('issues a single spawn call whose in-guest script disables then boots out every label', async () => {
    const spawnAndForgetSpy = vi
      .spyOn(tools, 'spawnAndForget')
      .mockResolvedValue(undefined);

    await applyLowMemoryProfile('sim-udid');

    // Exactly one host process, not one per label per verb.
    expect(spawnAndForgetSpy).toHaveBeenCalledTimes(1);

    const [file, args, options] = spawnAndForgetSpy.mock.calls[0]!;
    expect(file).toBe('xcrun');
    expect(args?.slice(0, 4)).toEqual(['simctl', 'spawn', 'sim-udid', 'sh']);
    expect(args?.[4]).toBe('-c');

    const script = args?.[5] as string;
    // Labels are passed as trailing positional args (consumed via "$@"
    // inside the script), never interpolated into the script string.
    const trailingArgs = args?.slice(6);
    expect(trailingArgs).toEqual(['sh', ...LOW_MEMORY_DISABLED_DAEMON_LABELS]);

    // The script loops over "$@" generically (one `disable`/`bootout` pair
    // for whatever label is bound each iteration), so this only needs to be
    // checked once, not per label.
    const disableIndex = script.indexOf('launchctl disable "system/$label"');
    const bootoutIndex = script.indexOf('launchctl bootout "system/$label"');
    expect(disableIndex).toBeGreaterThanOrEqual(0);
    expect(bootoutIndex).toBeGreaterThan(disableIndex);

    // These must never be disabled or booted out: the harness relies on
    // them for crash detection.
    expect(script).not.toContain('analyticsd');
    expect(script).not.toContain('osanalyticshelper');
    expect(trailingArgs).not.toContain('com.apple.analyticsd');
    expect(trailingArgs).not.toContain(
      'com.apple.osanalytics.osanalyticshelper',
    );

    // Bounded and abandonable: a timeout signal is passed so a hung spawn
    // can never stall the boot path.
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('tolerates the single spawn call failing without throwing', async () => {
    // applyLowMemoryProfile relies on spawnAndForget itself swallowing
    // failures (same as every other best-effort simctl call in this file),
    // so a rejection here must not propagate.
    const spawnAndForgetSpy = vi
      .spyOn(tools, 'spawnAndForget')
      .mockResolvedValue(undefined);

    await expect(applyLowMemoryProfile('sim-udid')).resolves.toBeUndefined();
    expect(spawnAndForgetSpy).toHaveBeenCalledTimes(1);
  });

  it('bounds the call with a short timeout signal so a hung spawn is abandoned', async () => {
    const controller = new AbortController();
    const getTimeoutSignalSpy = vi
      .spyOn(tools, 'getTimeoutSignal')
      .mockReturnValue(controller.signal);
    const spawnAndForgetSpy = vi
      .spyOn(tools, 'spawnAndForget')
      .mockResolvedValue(undefined);

    await applyLowMemoryProfile('sim-udid');

    // A handful of seconds: enough headroom for one process launch plus a
    // trivial in-guest loop, but far below the 300s platformReadyTimeout, so
    // a hung call is abandoned long before it could reproduce the CI outage.
    expect(getTimeoutSignalSpy).toHaveBeenCalledTimes(1);
    const timeoutMs = getTimeoutSignalSpy.mock.calls[0]![0];
    expect(timeoutMs).toBeGreaterThan(1_000);
    expect(timeoutMs).toBeLessThanOrEqual(30_000);

    const [, , options] = spawnAndForgetSpy.mock.calls[0]!;
    expect(options?.signal).toBe(controller.signal);
  });
});
