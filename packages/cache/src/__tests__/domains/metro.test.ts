import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeMetroStaticInputs } from '../../domains/metro.js';

describe('computeMetroStaticInputs', () => {
  let repoRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cache-metro-'));
    projectRoot = path.join(repoRoot, 'apps', 'mobile');
    fs.mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('includes a lockfile at an ancestor directory between projectRoot and repoRoot', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');

    const before = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-b');

    const after = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(before.lockfileHash).not.toBe(after.lockfileHash);
  });

  it('ignores a config file in a sibling directory not on the ancestor chain', () => {
    const siblingDir = path.join(repoRoot, 'apps', 'other');
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.writeFileSync(path.join(siblingDir, 'metro.config.js'), 'config-a');

    const before = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(siblingDir, 'metro.config.js'), 'config-b');

    const after = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(before.lockfileHash).toBe(after.lockfileHash);
  });

  it('excludes a vendored lockfile under node_modules (regression pin)', () => {
    // Pin for the old bug where a downward `hashFiles('**/pnpm-lock.yaml',
    // ...)`-style glob would match a dependency's own lockfile under
    // node_modules. Trivially true now that node_modules is never on the
    // upward ancestor chain, but kept as an explicit regression test.
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');
    const vendoredDir = path.join(projectRoot, 'node_modules', 'some-pkg');
    fs.mkdirSync(vendoredDir, { recursive: true });
    fs.writeFileSync(
      path.join(vendoredDir, 'package-lock.json'),
      'vendored-lockfile'
    );

    const withVendored = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.rmSync(path.join(projectRoot, 'node_modules'), {
      recursive: true,
      force: true,
    });

    const withoutVendored = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(withVendored.lockfileHash).toBe(withoutVendored.lockfileHash);
  });

  it('is deterministic across independent calls given the same fixture tree', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');
    fs.writeFileSync(path.join(projectRoot, 'metro.config.js'), 'config-a');

    const first = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });
    const second = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(first.lockfileHash).toBe(second.lockfileHash);
  });

  it('changes the hash when a matched file changes content', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');

    const before = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-b');

    const after = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(before.lockfileHash).not.toBe(after.lockfileHash);
  });

  it('does not change the hash when an unrelated file changes content', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');
    fs.writeFileSync(path.join(projectRoot, 'notes.txt'), 'v1');

    const before = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(projectRoot, 'notes.txt'), 'v2');

    const after = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(before.lockfileHash).toBe(after.lockfileHash);
  });

  it.each([
    ['metro.config.mts', 'metro-mts-a', 'metro-mts-b'],
    ['metro.config.cts', 'metro-cts-a', 'metro-cts-b'],
    ['metro.config.json', 'metro-json-a', 'metro-json-b'],
    ['babel.config.cts', 'babel-cts-a', 'babel-cts-b'],
  ])('picks up %s as a candidate at projectRoot', (filename, before, after) => {
    fs.writeFileSync(path.join(projectRoot, filename), before);

    const beforeInputs = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(projectRoot, filename), after);

    const afterInputs = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(beforeInputs.lockfileHash).not.toBe(afterInputs.lockfileHash);
  });

  it('picks up .config/metro.js as a candidate at projectRoot', () => {
    const configDir = path.join(projectRoot, '.config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'metro.js'), 'config-a');

    const before = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(configDir, 'metro.js'), 'config-b');

    const after = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(before.lockfileHash).not.toBe(after.lockfileHash);
  });

  it('no longer treats babel.config.ts as a candidate', () => {
    const before = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(projectRoot, 'babel.config.ts'), 'babel-ts-a');

    const afterCreate = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(projectRoot, 'babel.config.ts'), 'babel-ts-b');

    const afterChange = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(afterCreate.lockfileHash).toBe(before.lockfileHash);
    expect(afterChange.lockfileHash).toBe(before.lockfileHash);
  });

  it('passes bundlerMetroVersion and salt through into the returned object', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');

    const withoutSalt = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '2.3.4',
    });
    expect(withoutSalt.bundlerMetroVersion).toBe('2.3.4');
    expect(withoutSalt.salt).toBeUndefined();

    const withSalt = computeMetroStaticInputs({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '2.3.4',
      salt: 'v2',
    });
    expect(withSalt.salt).toBe('v2');
  });

  it('returns a stable fallback instead of throwing when projectRoot does not exist', () => {
    const missingProjectRoot = path.join(repoRoot, 'does-not-exist');

    const result = computeMetroStaticInputs({
      projectRoot: missingProjectRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(result).toEqual({
      lockfileHash: 'unavailable',
      bundlerMetroVersion: '1.0.0',
    });
  });

  it('returns a stable fallback instead of throwing when repoRoot does not exist', () => {
    const missingRepoRoot = path.join(repoRoot, 'does-not-exist');

    const result = computeMetroStaticInputs({
      projectRoot,
      repoRoot: missingRepoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(result).toEqual({
      lockfileHash: 'unavailable',
      bundlerMetroVersion: '1.0.0',
    });
  });

  it('works when projectRoot === repoRoot (single directory examined)', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');

    const before = computeMetroStaticInputs({
      projectRoot: repoRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-b');

    const after = computeMetroStaticInputs({
      projectRoot: repoRoot,
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(before.lockfileHash).not.toBe(after.lockfileHash);
  });
});
