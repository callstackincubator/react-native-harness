import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../types.js';

const baseConfig = {
  entryPoint: './index.js',
  appRegistryComponentName: 'App',
  runners: [
    {
      name: 'ios',
      config: {},
      runner: 'file:///runner.js',
      platformId: 'ios',
    },
  ],
};

describe('ConfigSchema bundler', () => {
  it('leaves the bundler unset when the config does not name one', () => {
    expect(ConfigSchema.parse(baseConfig).bundler).toBeUndefined();
  });

  it('keeps a bundler descriptor as given', () => {
    const bundler = {
      name: 'custom',
      displayName: 'Custom',
      module: 'file:///custom-bundler.js',
      config: { option: true },
    };

    expect(ConfigSchema.parse({ ...baseConfig, bundler }).bundler).toEqual(
      bundler
    );
  });

  it('preserves descriptor keys the schema does not list', () => {
    const bundler = {
      name: 'custom',
      displayName: 'Custom',
      module: 'file:///custom-bundler.js',
      config: {},
      extra: 'kept',
    };

    expect(ConfigSchema.parse({ ...baseConfig, bundler }).bundler).toEqual(
      bundler
    );
  });

  it('rejects a bundler without a module', () => {
    expect(() =>
      ConfigSchema.parse({
        ...baseConfig,
        bundler: { name: 'custom', displayName: 'Custom', config: {} },
      })
    ).toThrow();
  });
});
