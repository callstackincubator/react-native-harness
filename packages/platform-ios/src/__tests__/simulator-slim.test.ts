import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('@react-native-harness/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-native-harness/tools')>()),
  spawn: mocks.spawn,
}));

import {
  parsePrintDisabled,
  parseRunningLabels,
  SIMULATOR_QUIET_LOG_SUBSYSTEMS,
  SIMULATOR_SLIM_LABELS,
  slimSimulator,
} from '../simulator-slim.js';

const printDisabled = (labels: readonly string[]) =>
  `disabled services = {\n${labels
    .map((label) => `\t"${label}" => disabled\n`)
    .join('')}}\n`;

const launchctlList = (running: readonly string[]) =>
  `PID\tStatus\tLabel\n-\t0\tcom.apple.loaded-not-running\n${running
    .map((label, index) => `${100 + index}\t0\t${label}\n`)
    .join('')}`;

const mockLaunchd = ({
  disabled,
  running,
}: {
  disabled: readonly string[];
  running: readonly string[];
}) => {
  mocks.spawn.mockImplementation(async (_cmd: string, args: string[]) => {
    if (args.includes('print-disabled')) {
      return { stdout: printDisabled(disabled) };
    }
    if (args.at(-1) === 'list') {
      return { stdout: launchctlList(running) };
    }
    return { stdout: '' };
  });
};

const callsFor = (verb: string) =>
  mocks.spawn.mock.calls.filter(([, args]) =>
    (args as string[]).includes(verb)
  );

describe('parsePrintDisabled', () => {
  it('reads both the current and the older output format', () => {
    expect(
      parsePrintDisabled(
        '\t"com.apple.a" => disabled\n\t"com.apple.b" => enabled\n\t"com.apple.c" => true\n\t"com.apple.d" => false\n'
      )
    ).toEqual(new Set(['com.apple.a', 'com.apple.c']));
  });
});

describe('parseRunningLabels', () => {
  it('keeps only jobs with a PID', () => {
    expect(
      parseRunningLabels(
        'PID\tStatus\tLabel\n12\t0\tcom.apple.a\n-\t0\tcom.apple.b\n'
      )
    ).toEqual(new Set(['com.apple.a']));
  });
});

describe('slimSimulator', () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
  });

  it('only reads launchd when the boot was seeded', async () => {
    mockLaunchd({ disabled: SIMULATOR_SLIM_LABELS, running: [] });

    const result = await slimSimulator('SIM-1');

    expect(result.alreadyStopped).toHaveLength(SIMULATOR_SLIM_LABELS.length);
    expect(result.stopped).toEqual([]);
    expect(callsFor('disable')).toEqual([]);
    expect(callsFor('bootout')).toEqual([]);
    expect(result.quieted).toHaveLength(SIMULATOR_QUIET_LOG_SUBSYSTEMS.length);
  });

  it('disables enabled services and boots out only running ones', async () => {
    mockLaunchd({
      disabled: ['com.apple.chronod'],
      running: ['com.apple.chronod', 'com.apple.mediaanalysisd'],
    });

    const result = await slimSimulator('SIM-1');

    expect(mocks.spawn).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'spawn', 'SIM-1', 'launchctl', 'disable', 'system/com.apple.mediaanalysisd'],
      expect.anything()
    );
    expect(
      callsFor('disable').some(([, args]) =>
        (args as string[]).includes('system/com.apple.chronod')
      )
    ).toBe(false);
    expect(callsFor('bootout').map(([, args]) => (args as string[]).at(-1))).toEqual(
      expect.arrayContaining(['system/com.apple.chronod', 'system/com.apple.mediaanalysisd'])
    );
    expect(callsFor('bootout')).toHaveLength(2);
    expect(result.stopped).toEqual(
      expect.arrayContaining(['com.apple.chronod', 'com.apple.mediaanalysisd'])
    );
  });

  it('leaves PosterBoard alone in a booted simulator', async () => {
    mockLaunchd({ disabled: [], running: ['com.apple.PosterBoard'] });

    const result = await slimSimulator('SIM-1');

    expect(
      mocks.spawn.mock.calls.some(([, args]) =>
        (args as string[]).includes('system/com.apple.PosterBoard')
      )
    ).toBe(false);
    expect(result.stopped).not.toContain('com.apple.PosterBoard');
    expect(result.skipped).not.toContain('com.apple.PosterBoard');
  });

  it('disables and boots out every service when launchd cannot be read', async () => {
    mocks.spawn.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('print-disabled')) {
        throw new Error('launchd_sim busy');
      }
      return { stdout: '' };
    });

    const result = await slimSimulator('SIM-1');

    expect(result.alreadyStopped).toEqual([]);
    expect(result.stopped).toHaveLength(SIMULATOR_SLIM_LABELS.length - 1);
    expect(callsFor('disable')).toHaveLength(SIMULATOR_SLIM_LABELS.length - 1);
    expect(callsFor('bootout')).toHaveLength(SIMULATOR_SLIM_LABELS.length - 1);
  });

  it('skips a service whose disable fails and still counts one whose bootout fails', async () => {
    mocks.spawn.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('print-disabled')) {
        return { stdout: printDisabled([]) };
      }
      if (args.at(-1) === 'list') {
        return { stdout: launchctlList(['com.apple.mediaanalysisd']) };
      }
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
    expect(result.stopped).toContain('com.apple.mediaanalysisd');
    expect(result.stopped).toHaveLength(SIMULATOR_SLIM_LABELS.length - 2);
  });

  it('makes no further calls once the signal aborts', async () => {
    const controller = new AbortController();
    mocks.spawn.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('print-disabled') || args.at(-1) === 'list') {
        return { stdout: '' };
      }
      controller.abort();
      return { stdout: '' };
    });

    const result = await slimSimulator('SIM-1', {
      parallelism: 1,
      signal: controller.signal,
    });

    expect(result.timedOut).toBe(true);
    // Two reads, then the first service's disable; nothing runs, so no bootout.
    expect(mocks.spawn).toHaveBeenCalledTimes(3);
  });
});
