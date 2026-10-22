import { harnessCliOptions } from '@react-native-harness/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdditionalCliArgs } from '../cli-args.js';

const sampleValues = {
  string: { raw: '35', parsed: '35' },
  number: { raw: '08097', parsed: 8097 },
} as const;

const originalArgv = process.argv;

describe('getAdditionalCliArgs', () => {
  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('reads every option Harness registers with Jest', () => {
    const entries = Object.entries(harnessCliOptions);
    expect(entries.length).toBeGreaterThan(0);

    process.argv = [
      'node',
      'react-native-harness',
      ...entries.flatMap(([name, option]) => [
        `--${name}`,
        sampleValues[option.type].raw,
      ]),
    ];

    expect(getAdditionalCliArgs()).toEqual(
      Object.fromEntries(
        entries.map(([name, option]) => [
          name,
          sampleValues[option.type].parsed,
        ])
      )
    );
  });

  it('throws a port the config would reject without printing usage', () => {
    process.argv = ['node', 'jest', '--metroPort=0'];
    const consoleError = vi.spyOn(console, 'error');

    expect(() => getAdditionalCliArgs()).toThrow(
      'Invalid --metroPort: Metro port must be at least 1'
    );
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('leaves an option the command line does not pass undefined', () => {
    process.argv = ['node', 'react-native-harness'];

    expect(getAdditionalCliArgs()).toEqual(
      Object.fromEntries(
        Object.keys(harnessCliOptions).map((name) => [name, undefined])
      )
    );
  });
});
