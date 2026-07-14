import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveBundlerMetroVersion,
  resolveRepoRoot,
} from '../metro-cache-inputs.js';

describe('resolveRepoRoot', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gha-repo-root-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('walks up to the nearest ancestor containing a .git directory', () => {
    fs.mkdirSync(path.join(root, '.git'));
    const projectRoot = path.join(root, 'apps', 'mobile');
    fs.mkdirSync(projectRoot, { recursive: true });

    expect(resolveRepoRoot(projectRoot)).toBe(root);
  });

  it('falls back to projectRoot when no .git directory is found', () => {
    const projectRoot = path.join(root, 'no-git-here');
    fs.mkdirSync(projectRoot, { recursive: true });

    expect(resolveRepoRoot(projectRoot)).toBe(projectRoot);
  });
});

describe('resolveBundlerMetroVersion', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gha-bundler-metro-version-')
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('resolves the version from the consuming project\'s installed package', () => {
    const packageDir = path.join(
      projectRoot,
      'node_modules',
      '@react-native-harness',
      'bundler-metro'
    );
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@react-native-harness/bundler-metro',
        version: '9.9.9',
        main: 'index.js',
      })
    );
    fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {};');

    expect(resolveBundlerMetroVersion(projectRoot)).toBe('9.9.9');
  });

  it('falls back to "unknown" and warns when the package cannot be resolved', () => {
    expect(resolveBundlerMetroVersion(projectRoot)).toBe('unknown');
    expect(console.warn).toHaveBeenCalled();
  });
});
