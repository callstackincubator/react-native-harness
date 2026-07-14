import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarnessCache } from '../index.js';

describe('createHarnessCache', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cache-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exposes paths rooted at <projectRoot>/.harness/cache', () => {
    const cache = createHarnessCache({ projectRoot });

    expect(cache.paths.root).toBe(path.join(projectRoot, '.harness', 'cache'));
  });

  it('reports metro as cold before directories exist', () => {
    const cache = createHarnessCache({ projectRoot });

    expect(cache.isWarm('metro')).toBe(false);
  });

  it('creates domain directories and reports warm once populated', () => {
    const cache = createHarnessCache({ projectRoot });

    cache.ensureDomainDirectories('metro');

    expect(fs.existsSync(cache.paths.metroTransform)).toBe(true);
    expect(fs.existsSync(cache.paths.metroFileMap)).toBe(true);
    expect(cache.isWarm('metro')).toBe(false);

    fs.writeFileSync(path.join(cache.paths.metroTransform, 'entry'), 'data');
    expect(cache.isWarm('metro')).toBe(true);
  });

  it('swallows and logs errors instead of throwing when directories cannot be created', () => {
    // Point the project root at a path that cannot be created (its parent is a file).
    const blockedRoot = path.join(projectRoot, 'blocked-file', 'nested');
    fs.writeFileSync(path.join(projectRoot, 'blocked-file'), 'not a directory');

    const cache = createHarnessCache({ projectRoot: blockedRoot });

    expect(() => cache.ensureDomainDirectories('metro')).not.toThrow();
    expect(cache.isWarm('metro')).toBe(false);
  });
});
