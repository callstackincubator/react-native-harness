import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getLaunchdOverridesPath,
  parseLaunchdOverrides,
  seedSimulatorSlim,
  serializeLaunchdOverrides,
  SIMULATOR_SLIM_LABELS,
} from '../simulator-slim-seed.js';

const FORBIDDEN_LABELS = [
  // simslim: these wedge a simulator or break its boot when disabled.
  'com.apple.nanoregistryd',
  'com.apple.nanoregistrylaunchd',
  'com.apple.nanoprefsyncd.2',
  'com.apple.nanotimekitcompaniond',
  'com.apple.nanobackupd',
  'com.apple.sleepd',
  'com.apple.appprotectiond',
  'com.apple.ManagedSettingsAgent',
  'com.apple.managedconfiguration.profiled',
  'com.apple.mobiletimerd',
  'com.apple.routined',
  'com.apple.biomed',
  'com.apple.biomesyncd',
  'com.apple.dmd',
  'com.apple.donotdisturbd',
  // simslim: XCUITest app launches stall without gamed; Spotlight leaks
  // memory without assistantd.
  'com.apple.gamed',
  'com.apple.assistantd',
  // Harness itself depends on these.
  'com.apple.SpringBoard',
  'com.apple.backboardd',
  'com.apple.runningboardd',
  'com.apple.tccd',
  'com.apple.testmanagerd',
  'com.apple.mobile.installd',
  'com.apple.ReportCrash',
];

describe('SIMULATOR_SLIM_LABELS', () => {
  it('never includes a service a simulator or Harness needs', () => {
    expect(SIMULATOR_SLIM_LABELS).not.toEqual(
      expect.arrayContaining([expect.toBeOneOf(FORBIDDEN_LABELS)])
    );
  });

  it('has no duplicates', () => {
    expect(new Set(SIMULATOR_SLIM_LABELS).size).toBe(
      SIMULATOR_SLIM_LABELS.length
    );
  });
});

describe('seedSimulatorSlim', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-slim-seed-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes every label as disabled for a never-booted simulator', () => {
    const result = seedSimulatorSlim('SIM-1', { root });

    expect(result).toEqual({
      seeded: true,
      path: getLaunchdOverridesPath('SIM-1', root),
      added: SIMULATOR_SLIM_LABELS.length,
    });
    const entries = parseLaunchdOverrides(
      fs.readFileSync(getLaunchdOverridesPath('SIM-1', root), 'utf8')
    );
    expect(entries.size).toBe(SIMULATOR_SLIM_LABELS.length);
    expect([...entries.values()].every(Boolean)).toBe(true);
  });

  it('keeps the entries the runtime wrote and is idempotent', () => {
    const overridesPath = getLaunchdOverridesPath('SIM-1', root);
    fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
    fs.writeFileSync(
      overridesPath,
      serializeLaunchdOverrides(
        new Map([
          ['com.apple.runtime.enabled', false],
          ['com.apple.chronod', false],
        ])
      )
    );

    expect(seedSimulatorSlim('SIM-1', { root })).toMatchObject({
      seeded: true,
      added: SIMULATOR_SLIM_LABELS.length,
    });
    const entries = parseLaunchdOverrides(fs.readFileSync(overridesPath, 'utf8'));
    expect(entries.get('com.apple.runtime.enabled')).toBe(false);
    expect(entries.get('com.apple.chronod')).toBe(true);

    expect(seedSimulatorSlim('SIM-1', { root })).toMatchObject({
      seeded: true,
      added: 0,
    });
  });

  it('leaves overrides it cannot read untouched', () => {
    const overridesPath = getLaunchdOverridesPath('SIM-1', root);
    fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
    fs.writeFileSync(overridesPath, 'bplist00');

    expect(seedSimulatorSlim('SIM-1', { root })).toMatchObject({
      seeded: false,
    });
    expect(fs.readFileSync(overridesPath, 'utf8')).toBe('bplist00');
  });

  it('reports a failure instead of throwing', () => {
    const file = path.join(root, 'not-a-directory');
    fs.writeFileSync(file, '');

    expect(seedSimulatorSlim('SIM-1', { root: file })).toMatchObject({
      seeded: false,
    });
  });
});

describe('serializeLaunchdOverrides', () => {
  it('round-trips labels that need escaping', () => {
    const entries = new Map([
      ['com.example.a&b', true],
      ['com.example.c', false],
    ]);

    expect(parseLaunchdOverrides(serializeLaunchdOverrides(entries))).toEqual(
      entries
    );
  });
});
