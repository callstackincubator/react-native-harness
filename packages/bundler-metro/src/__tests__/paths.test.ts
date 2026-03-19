import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getHarnessManifestPath,
  getHarnessMetroCachePath,
  getHarnessRootPath,
  isMetroCacheReusable,
} from '../paths.js';

const tempDirs: string[] = [];

const createTempProjectRoot = (): string => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rn-harness-bundler-metro-')
  );
  tempDirs.push(tempDir);
  return tempDir;
};

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('bundler metro paths', () => {
  it('resolves the harness root under the project root', () => {
    const projectRoot = createTempProjectRoot();

    expect(getHarnessRootPath(projectRoot)).toBe(
      path.join(projectRoot, '.harness')
    );
    expect(getHarnessManifestPath(projectRoot)).toBe(
      path.join(projectRoot, '.harness', 'manifest.js')
    );
    expect(getHarnessMetroCachePath(projectRoot)).toBe(
      path.join(projectRoot, '.harness', 'metro-cache')
    );
  });

  it('returns false when the metro cache directory is missing', () => {
    const projectRoot = createTempProjectRoot();

    expect(isMetroCacheReusable(projectRoot)).toBe(false);
  });

  it('returns false when the metro cache directory is empty', () => {
    const projectRoot = createTempProjectRoot();
    fs.mkdirSync(getHarnessMetroCachePath(projectRoot), { recursive: true });

    expect(isMetroCacheReusable(projectRoot)).toBe(false);
  });

  it('returns true when the metro cache directory contains entries', () => {
    const projectRoot = createTempProjectRoot();
    const metroCachePath = getHarnessMetroCachePath(projectRoot);

    fs.mkdirSync(metroCachePath, { recursive: true });
    fs.writeFileSync(path.join(metroCachePath, 'entry'), 'cached');

    expect(isMetroCacheReusable(projectRoot)).toBe(true);
  });
});
