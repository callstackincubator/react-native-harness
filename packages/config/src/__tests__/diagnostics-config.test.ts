import { describe, expect, it } from 'vitest';
import {
  ConfigSchema,
  isDiagnosticsEnabled,
  resolveDiagnosticsOptions,
} from '../types.js';

const baseConfig = {
  entryPoint: './index.js',
  appRegistryComponentName: 'App',
  runners: [
    {
      name: 'test-runner',
      config: {},
      runner: 'test-runner',
      platformId: 'test-platform',
    },
  ],
};

const parse = (diagnostics?: unknown) =>
  ConfigSchema.parse({ ...baseConfig, diagnostics });

describe('ConfigSchema diagnostics', () => {
  it('defaults to false', () => {
    expect(parse().diagnostics).toBe(false);
  });

  it('accepts the boolean form', () => {
    expect(parse(true).diagnostics).toBe(true);
    expect(parse(false).diagnostics).toBe(false);
  });

  it('accepts the object form', () => {
    const diagnostics = {
      enabled: true,
      probes: { host: true, node: false, snapshots: false, platform: true },
      sampleIntervalMs: 2000,
    };

    expect(parse(diagnostics).diagnostics).toEqual(diagnostics);
    expect(parse({}).diagnostics).toEqual({});
  });

  it.each([
    ['an unknown key', { enable: true }],
    ['an unknown probe', { probes: { cpu: true } }],
    ['a non-boolean probe switch', { probes: { host: 'yes' } }],
    ['a too small interval', { sampleIntervalMs: 10 }],
    ['a fractional interval', { sampleIntervalMs: 1000.5 }],
    ['a string', 'true'],
  ])('rejects %s', (_name, diagnostics) => {
    expect(() => parse(diagnostics)).toThrow();
  });
});

describe('isDiagnosticsEnabled', () => {
  it('is off without config or environment', () => {
    expect(isDiagnosticsEnabled(undefined, {})).toBe(false);
    expect(isDiagnosticsEnabled({ diagnostics: false }, {})).toBe(false);
  });

  it('is on for true and for an object unless it opts out', () => {
    expect(isDiagnosticsEnabled({ diagnostics: true }, {})).toBe(true);
    expect(isDiagnosticsEnabled({ diagnostics: {} }, {})).toBe(true);
    expect(
      isDiagnosticsEnabled({ diagnostics: { sampleIntervalMs: 1000 } }, {})
    ).toBe(true);
    expect(isDiagnosticsEnabled({ diagnostics: { enabled: false } }, {})).toBe(
      false
    );
  });

  it.each(['1', 'true', 'yes'])(
    'RN_HARNESS_DIAGNOSTICS=%s enables it',
    (value) => {
      expect(
        isDiagnosticsEnabled(
          { diagnostics: false },
          { RN_HARNESS_DIAGNOSTICS: value }
        )
      ).toBe(true);
    }
  );

  it.each(['', '0', 'false'])('RN_HARNESS_DIAGNOSTICS=%j does not', (value) => {
    expect(
      isDiagnosticsEnabled(
        { diagnostics: false },
        { RN_HARNESS_DIAGNOSTICS: value }
      )
    ).toBe(false);
  });
});

describe('resolveDiagnosticsOptions', () => {
  const allOn = { host: true, node: true, snapshots: true, platform: true };

  it('turns every probe on by default for every form', () => {
    for (const diagnostics of [false, true, {}]) {
      expect(resolveDiagnosticsOptions({ diagnostics })).toEqual({
        probes: allOn,
        sampleIntervalMs: undefined,
      });
    }
  });

  it('resolves defaults without a config', () => {
    expect(resolveDiagnosticsOptions(undefined)).toEqual({
      probes: allOn,
      sampleIntervalMs: undefined,
    });
  });

  it('applies overrides and keeps the rest on', () => {
    expect(
      resolveDiagnosticsOptions({
        diagnostics: {
          probes: { snapshots: false },
          sampleIntervalMs: 1000,
        },
      })
    ).toEqual({
      probes: { ...allOn, snapshots: false },
      sampleIntervalMs: 1000,
    });
  });
});
