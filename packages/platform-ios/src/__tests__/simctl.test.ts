import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as tools from '@react-native-harness/tools';
import {
  diagnose,
  getGuestProcessCount,
  parseBootStatus,
  streamLogs,
  waitForBoot,
} from '../xcrun/simctl.js';
import {
  simctlErrorAttrs,
  simctlResultAttrs,
} from '../xcrun/simctl-diagnostics.js';

// Trimmed from a real `xcrun simctl bootstatus <udid> -b` run.
const BOOTSTATUS_OUTPUT = `Monitoring boot status for iPhone 17e (0461A3FF-A9E3-4DEB-BA20-13E75B01B530).
[2026-10-16 06:47:07 +0000] Status=1, isTerminal=NO, Elapsed=00:03.
\u251c\u2500\u2500\u2524Waiting on BackBoard

[2026-10-16 06:47:08 +0000] Status=2, isTerminal=NO, Elapsed=00:05.
\u251c\u2500\u2500\u2524Waiting on Data Migration
\u251c\u2500\u2500\u2524\u251c\u2500\u2500\u2524Reason:Running plugin com.apple.MobileContainerManager.ContainerMigrator
\u251c\u2500\u2500\u2524\u251c\u2500\u2500\u2524Migration Elapsed:00:00 seconds

[2026-10-16 06:47:59 +0000] Status=4, isTerminal=NO, Elapsed=01:56.
\tWaiting on System App
`;


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

  it('returns the last reported stage and elapsed time from bootstatus', async () => {
    vi.spyOn(tools, 'spawn').mockResolvedValue({
      stdout: BOOTSTATUS_OUTPUT,
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await expect(
      waitForBoot('sim-udid', new AbortController().signal),
    ).resolves.toEqual({
      lastStatusLine: 'Waiting on System App',
      elapsedSeconds: 116,
    });
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

  it('counts only running guest processes, not loaded jobs without a PID', async () => {
    const signal = new AbortController().signal;
    const spawnSpy = vi.spyOn(tools, 'spawn').mockResolvedValue({
      stdout:
        'PID\tStatus\tLabel\n-\t0\tcom.apple.progressd\n95823\t0\tcom.apple.homed\n-\t78\tcom.apple.cloudphotod\n402\t0\tcom.apple.backboardd\n',
    } as Awaited<ReturnType<typeof tools.spawn>>);

    await expect(getGuestProcessCount('sim-udid', signal)).resolves.toBe(2);
    expect(spawnSpy).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'spawn', 'sim-udid', 'launchctl', 'list'],
      { timeout: 30_000, signal },
    );
  });
});

describe('parseBootStatus', () => {
  it('handles empty and unrecognised output', () => {
    expect(parseBootStatus(undefined)).toEqual({
      lastStatusLine: null,
      elapsedSeconds: null,
    });
    expect(parseBootStatus('something else\n')).toEqual({
      lastStatusLine: null,
      elapsedSeconds: null,
    });
  });

  it('reports the terminal stage once the boot has finished', () => {
    expect(
      parseBootStatus(
        '[2026-10-16 06:48:02 +0000] Status=4294967295, isTerminal=YES, Elapsed=00:58.\n\tFinished\n',
      ),
    ).toEqual({ lastStatusLine: 'Finished', elapsedSeconds: 58 });
  });
});

describe('simctl diagnostics attrs', () => {
  it('describes a waitForBoot result and nothing else', () => {
    expect(
      simctlResultAttrs('waitForBoot', {
        lastStatusLine: 'Finished',
        elapsedSeconds: 58,
      }),
    ).toEqual({ bootLastStatus: 'Finished', bootElapsedSeconds: 58 });
    expect(simctlResultAttrs('bootSimulator', undefined)).toBeUndefined();
  });

  it('recovers the stage a timed-out waitForBoot was stuck on', () => {
    const error = Object.assign(Object.create(tools.SubprocessError.prototype), {
      stdout: BOOTSTATUS_OUTPUT,
    });

    expect(simctlErrorAttrs('waitForBoot', error)).toEqual({
      bootLastStatus: 'Waiting on System App',
      bootElapsedSeconds: 116,
    });
    expect(simctlErrorAttrs('waitForBoot', new Error('x'))).toBeUndefined();
    expect(simctlErrorAttrs('bootSimulator', error)).toBeUndefined();
  });
});
