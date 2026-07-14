import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeMetroStaticInputs } from '../../domains/metro.js';

describe('computeMetroStaticInputs', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cache-metro-'));
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('only hashes recognized key filenames, ignoring unrelated files', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');
    fs.mkdirSync(path.join(repoRoot, 'nested'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'nested', 'metro.config.js'),
      'config-a'
    );
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'irrelevant');

    const withoutReadme = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'changed irrelevant');

    const withChangedReadme = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(withoutReadme.lockfileHash).toBe(withChangedReadme.lockfileHash);
  });

  it('excludes matched files vendored under node_modules', () => {
    // This is the correctness fix over today's
    // `hashFiles('**/pnpm-lock.yaml', ...)`, which globs inside
    // node_modules and would pick up a dependency's own lockfile.
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');
    const vendoredDir = path.join(repoRoot, 'node_modules', 'some-pkg');
    fs.mkdirSync(vendoredDir, { recursive: true });
    fs.writeFileSync(
      path.join(vendoredDir, 'package-lock.json'),
      'vendored-lockfile'
    );

    const withVendored = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.rmSync(path.join(repoRoot, 'node_modules'), {
      recursive: true,
      force: true,
    });

    const withoutVendored = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(withVendored.lockfileHash).toBe(withoutVendored.lockfileHash);
  });

  it('is deterministic across independent calls given the same fixture tree', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');
    fs.writeFileSync(path.join(repoRoot, 'metro.config.js'), 'config-a');

    const first = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });
    const second = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(first.lockfileHash).toBe(second.lockfileHash);
  });

  it('changes the hash when a matched file changes content', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');

    const before = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-b');

    const after = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(before.lockfileHash).not.toBe(after.lockfileHash);
  });

  it('does not change the hash when an unrelated file changes content', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');
    fs.writeFileSync(path.join(repoRoot, 'notes.txt'), 'v1');

    const before = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    fs.writeFileSync(path.join(repoRoot, 'notes.txt'), 'v2');

    const after = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(before.lockfileHash).toBe(after.lockfileHash);
  });

  it('passes bundlerMetroVersion and salt through into the returned object', () => {
    fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lockfile-a');

    const withoutSalt = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '2.3.4',
    });
    expect(withoutSalt.bundlerMetroVersion).toBe('2.3.4');
    expect(withoutSalt.salt).toBeUndefined();

    const withSalt = computeMetroStaticInputs({
      repoRoot,
      bundlerMetroVersion: '2.3.4',
      salt: 'v2',
    });
    expect(withSalt.salt).toBe('v2');
  });

  it('returns a stable fallback instead of throwing when repoRoot does not exist', () => {
    const missingRoot = path.join(repoRoot, 'does-not-exist');

    const result = computeMetroStaticInputs({
      repoRoot: missingRoot,
      bundlerMetroVersion: '1.0.0',
    });

    expect(result).toEqual({
      lockfileHash: 'unavailable',
      bundlerMetroVersion: '1.0.0',
    });
  });
});
