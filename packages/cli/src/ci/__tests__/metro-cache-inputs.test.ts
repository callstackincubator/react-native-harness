import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveBundlerMetroVersion,
  resolveMetroStaticInputs,
  resolveRepoRoot,
} from '../metro-cache-inputs.js';

const mocks = vi.hoisted(() => ({
  computeMetroStaticInputs: vi.fn(),
}));

// This package's job is wiring, not re-testing @react-native-harness/cache's
// own logic, so its exports are mocked rather than exercised for real.
vi.mock('@react-native-harness/cache', () => ({
  computeMetroStaticInputs: mocks.computeMetroStaticInputs,
}));

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

  it('resolves the version through @react-native-harness/jest when bundler-metro is only a nested dependency', () => {
    const jestPackageDir = path.join(
      projectRoot,
      'node_modules',
      '@react-native-harness',
      'jest'
    );
    fs.mkdirSync(jestPackageDir, { recursive: true });
    fs.writeFileSync(
      path.join(jestPackageDir, 'package.json'),
      JSON.stringify({
        name: '@react-native-harness/jest',
        version: '1.0.0',
        main: 'index.js',
      })
    );
    fs.writeFileSync(path.join(jestPackageDir, 'index.js'), 'module.exports = {};');

    const nestedBundlerMetroDir = path.join(
      jestPackageDir,
      'node_modules',
      '@react-native-harness',
      'bundler-metro'
    );
    fs.mkdirSync(nestedBundlerMetroDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedBundlerMetroDir, 'package.json'),
      JSON.stringify({
        name: '@react-native-harness/bundler-metro',
        version: '2.2.2',
        main: 'index.js',
      })
    );
    fs.writeFileSync(
      path.join(nestedBundlerMetroDir, 'index.js'),
      'module.exports = {};'
    );

    expect(resolveBundlerMetroVersion(projectRoot)).toBe('2.2.2');
  });

  it('falls back to "unknown" and warns when the package cannot be resolved', () => {
    expect(resolveBundlerMetroVersion(projectRoot)).toBe('unknown');
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('resolveMetroStaticInputs', () => {
  let repoRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gha-static-inputs-'));
    fs.mkdirSync(path.join(repoRoot, '.git'));
    projectRoot = path.join(repoRoot, 'apps', 'mobile');

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
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('forwards projectRoot, the resolved repoRoot, bundlerMetroVersion, and salt', () => {
    mocks.computeMetroStaticInputs.mockReturnValue({ lockfileHash: 'abc' });

    const result = resolveMetroStaticInputs({
      projectRoot,
      cacheVersionSalt: 'v2',
    });

    expect(mocks.computeMetroStaticInputs).toHaveBeenCalledWith({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '9.9.9',
      salt: 'v2',
    });
    expect(result).toEqual({ lockfileHash: 'abc' });
  });

  it('omits the salt when no cacheVersionSalt is provided', () => {
    mocks.computeMetroStaticInputs.mockReturnValue({ lockfileHash: 'abc' });

    resolveMetroStaticInputs({ projectRoot });

    expect(mocks.computeMetroStaticInputs).toHaveBeenCalledWith({
      projectRoot,
      repoRoot,
      bundlerMetroVersion: '9.9.9',
      salt: undefined,
    });
  });
});
