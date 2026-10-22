import { harnessCliOptions } from '@react-native-harness/config';
import { buildArgv, yargsOptions } from 'jest-cli';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchYargsOptions } from '../jest-cli-options.js';

const sampleValues = {
  string: { raw: '35', parsed: '35' },
  number: { raw: '08097', parsed: 8097 },
} as const;

const originalYargsOptions = { ...yargsOptions };

describe('patchYargsOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const name of Object.keys(yargsOptions)) {
      delete yargsOptions[name];
    }
    Object.assign(yargsOptions, originalYargsOptions);
  });

  it('has at least one Harness option to register', () => {
    expect(Object.keys(harnessCliOptions).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(harnessCliOptions))(
    'lets Jest accept --%s, which Harness reads from the command line',
    async (name, option) => {
      patchYargsOptions();

      const sample = sampleValues[option.type];
      const argv = await buildArgv([`--${name}`, sample.raw]);

      expect(argv).toMatchObject({ [name]: sample.parsed });
    }
  );

  it('stops Jest with the reason when --metroPort is a port the config would reject', async () => {
    patchYargsOptions();
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(buildArgv(['--metroPort', '0'])).rejects.toThrow(
      'process.exit(1)'
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Invalid --metroPort: Metro port must be at least 1'
    );
  });
});
