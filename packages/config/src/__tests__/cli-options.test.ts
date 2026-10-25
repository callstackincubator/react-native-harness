import { describe, expect, it } from 'vitest';
import { harnessCliOptions } from '../cli-options.js';
import { ConfigSchema } from '../types.js';

const { coerce } = harnessCliOptions.metroPort;

const parseConfigWithMetroPort = (metroPort: unknown) =>
  ConfigSchema.safeParse({
    entryPoint: './index.js',
    appRegistryComponentName: 'App',
    runners: [
      { name: 'android', config: {}, runner: 'runner', platformId: 'android' },
    ],
    metroPort,
  });

describe('--metroPort', () => {
  it.each([1, 8081, 65535])('accepts %s, as the config does', (port) => {
    expect(coerce(port)).toBe(port);
    expect(parseConfigWithMetroPort(port)).toMatchObject({
      success: true,
      data: { metroPort: port },
    });
  });

  it.each([
    [0, 'Metro port must be at least 1'],
    [70000, 'Metro port must be at most 65535'],
    [80.5, 'Metro port must be an integer'],
    [Number.NaN, 'Expected number, received nan'],
    [[8097, 8098], 'Expected number, received array'],
  ])('rejects %s for the reason the config does', (value, message) => {
    expect(() => coerce(value)).toThrow(`Invalid --metroPort: ${message}`);
    expect(parseConfigWithMetroPort(value).error?.issues).toEqual([
      expect.objectContaining({ path: ['metroPort'], message }),
    ]);
  });
});
