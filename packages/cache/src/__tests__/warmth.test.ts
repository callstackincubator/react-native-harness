import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarnessCachePaths } from '../paths.js';
import { isDomainWarm } from '../warmth.js';

describe('isDomainWarm', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cache-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('is false when the domain directory does not exist', () => {
    const paths = createHarnessCachePaths(projectRoot);

    expect(isDomainWarm('metro', paths)).toBe(false);
  });

  it('is false when the domain directory exists but is empty', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(paths.metroTransform, { recursive: true });

    expect(isDomainWarm('metro', paths)).toBe(false);
  });

  it('is true when the domain directory exists and has entries', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(paths.metroTransform, { recursive: true });
    fs.writeFileSync(path.join(paths.metroTransform, 'entry'), 'data');

    expect(isDomainWarm('metro', paths)).toBe(true);
  });

  it('is false when the path exists but is a file, not a directory', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(path.dirname(paths.metroTransform), { recursive: true });
    fs.writeFileSync(paths.metroTransform, 'not a directory');

    expect(isDomainWarm('metro', paths)).toBe(false);
  });
});
