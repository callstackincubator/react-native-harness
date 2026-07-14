import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarnessCachePaths } from '../paths.js';
import {
  planRestore,
  planSave,
  snapshot,
  writeKeysFile,
  type CacheKeyInputs,
  type CacheSnapshot,
} from '../plan.js';

describe('planRestore', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cache-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const inputs = (
    staticInputs: Record<string, string>
  ): Record<'metro', CacheKeyInputs> => ({
    metro: { os: 'linux', staticInputs },
  });

  it('produces the same restoreKey across independent calls given the same staticInputs', () => {
    const paths = createHarnessCachePaths(projectRoot);

    const first = planRestore(paths, inputs({ a: '1', b: '2' }));
    const second = planRestore(paths, inputs({ a: '1', b: '2' }));

    expect(first.domains.metro?.restoreKey).toBe(
      second.domains.metro?.restoreKey
    );
  });

  it('produces the same restoreKey regardless of staticInputs key order', () => {
    const paths = createHarnessCachePaths(projectRoot);

    const first = planRestore(paths, inputs({ a: '1', b: '2' }));
    const second = planRestore(paths, inputs({ b: '2', a: '1' }));

    expect(first.domains.metro?.restoreKey).toBe(
      second.domains.metro?.restoreKey
    );
  });

  it('produces a different restoreKey for different staticInputs', () => {
    const paths = createHarnessCachePaths(projectRoot);

    const first = planRestore(paths, inputs({ a: '1' }));
    const second = planRestore(paths, inputs({ a: '2' }));

    expect(first.domains.metro?.restoreKey).not.toBe(
      second.domains.metro?.restoreKey
    );
  });

  it('shapes restorePrefixes for the accretive metro domain as a single trailing-dash prefix', () => {
    const paths = createHarnessCachePaths(projectRoot);
    const plan = planRestore(paths, inputs({ a: '1' }));
    const domain = plan.domains.metro;

    expect(domain?.accretive).toBe(true);
    expect(domain?.restorePrefixes).toEqual([`${domain?.restoreKey}-`]);
  });

  it('only includes domains present in the inputs', () => {
    const paths = createHarnessCachePaths(projectRoot);
    const plan = planRestore(paths, {});

    expect(plan.domains).toEqual({});
  });

  it('reports the domain cache directories as paths', () => {
    const paths = createHarnessCachePaths(projectRoot);
    const plan = planRestore(paths, inputs({ a: '1' }));

    expect(plan.domains.metro?.paths).toEqual([
      paths.metroTransform,
      paths.metroFileMap,
    ]);
  });
});

describe('snapshot', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cache-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('is empty for a domain whose directories do not exist', () => {
    const paths = createHarnessCachePaths(projectRoot);

    expect(() => snapshot(paths)).not.toThrow();
    expect(snapshot(paths).metro).toEqual([]);
  });

  it('collects entries for files under the domain directories', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(path.join(paths.metroTransform, 'nested'), {
      recursive: true,
    });
    fs.writeFileSync(path.join(paths.metroTransform, 'a.txt'), 'aaa');
    fs.writeFileSync(
      path.join(paths.metroTransform, 'nested', 'b.txt'),
      'bb'
    );

    const result = snapshot(paths);
    const entries = result.metro ?? [];

    expect(entries).toHaveLength(2);
    const aEntry = entries.find((entry) =>
      entry.path.endsWith(path.join('metro', 'a.txt'))
    );
    const bEntry = entries.find((entry) =>
      entry.path.endsWith(path.join('metro', 'nested', 'b.txt'))
    );
    expect(aEntry?.sizeBytes).toBe(3);
    expect(bEntry?.sizeBytes).toBe(2);
    expect(typeof aEntry?.mtimeMs).toBe('number');
  });
});

describe('planSave', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cache-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const inputs = (
    staticInputs: Record<string, string> = { a: '1' }
  ): Record<'metro', CacheKeyInputs> => ({
    metro: { os: 'linux', staticInputs },
  });

  it('does not save when there is no change, regardless of policy', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(paths.metroTransform, { recursive: true });
    fs.writeFileSync(path.join(paths.metroTransform, 'a.txt'), 'aaa');

    const before = snapshot(paths);
    const plan = planSave(
      paths,
      before,
      { mode: 'always', isDefaultBranch: true },
      inputs()
    );

    expect(plan.domains.metro?.shouldSave).toBe(false);
    expect(plan.domains.metro?.delta).toEqual({
      addedEntries: 0,
      removedEntries: 0,
      addedBytes: 0,
    });
  });

  it('saves an added file only when policy allows it', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(paths.metroTransform, { recursive: true });
    const before = snapshot(paths);

    fs.writeFileSync(path.join(paths.metroTransform, 'a.txt'), 'aaa');

    const disallowed = planSave(
      paths,
      before,
      { mode: 'default-branch', isDefaultBranch: false },
      inputs()
    );
    expect(disallowed.domains.metro?.shouldSave).toBe(false);
    expect(disallowed.domains.metro?.delta.addedEntries).toBe(1);
    expect(disallowed.domains.metro?.delta.addedBytes).toBe(3);

    const allowed = planSave(
      paths,
      before,
      { mode: 'default-branch', isDefaultBranch: true },
      inputs()
    );
    expect(allowed.domains.metro?.shouldSave).toBe(true);
  });

  it('never saves when policy mode is "never"', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(paths.metroTransform, { recursive: true });
    const before = snapshot(paths);
    fs.writeFileSync(path.join(paths.metroTransform, 'a.txt'), 'aaa');

    const plan = planSave(
      paths,
      before,
      { mode: 'never', isDefaultBranch: true },
      inputs()
    );

    expect(plan.domains.metro?.shouldSave).toBe(false);
  });

  it('counts a removed file in the delta', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(paths.metroTransform, { recursive: true });
    fs.writeFileSync(path.join(paths.metroTransform, 'a.txt'), 'aaa');
    const before = snapshot(paths);

    fs.rmSync(path.join(paths.metroTransform, 'a.txt'));

    const plan = planSave(
      paths,
      before,
      { mode: 'always', isDefaultBranch: true },
      inputs()
    );

    expect(plan.domains.metro?.delta.removedEntries).toBe(1);
    expect(plan.domains.metro?.shouldSave).toBe(true);
  });

  it('does not treat an mtime-only change as an added entry or change the content hash', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(paths.metroTransform, { recursive: true });
    const filePath = path.join(paths.metroTransform, 'a.txt');
    fs.writeFileSync(filePath, 'aaa');
    const before = snapshot(paths);

    const beforeSave = planSave(
      paths,
      before,
      { mode: 'always', isDefaultBranch: true },
      inputs()
    );

    // Touch the file's mtime without changing its size/content.
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(filePath, future, future);

    const afterSave = planSave(
      paths,
      before,
      { mode: 'always', isDefaultBranch: true },
      inputs()
    );

    expect(afterSave.domains.metro?.delta.addedEntries).toBe(0);
    expect(afterSave.domains.metro?.shouldSave).toBe(false);
    expect(afterSave.domains.metro?.saveKey).toBe(
      beforeSave.domains.metro?.saveKey
    );
  });

  it('produces a deterministic saveKey across independent planSave calls given the same on-disk state', () => {
    const paths = createHarnessCachePaths(projectRoot);
    fs.mkdirSync(paths.metroTransform, { recursive: true });
    fs.writeFileSync(path.join(paths.metroTransform, 'a.txt'), 'aaa');
    const before: CacheSnapshot = {};

    const first = planSave(
      paths,
      before,
      { mode: 'always', isDefaultBranch: true },
      inputs()
    );
    const second = planSave(
      paths,
      before,
      { mode: 'always', isDefaultBranch: true },
      inputs()
    );

    expect(first.domains.metro?.saveKey).toBe(second.domains.metro?.saveKey);
  });
});

describe('writeKeysFile', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cache-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes keys.json under the cache root, outside domain subdirectories', () => {
    const paths = createHarnessCachePaths(projectRoot);
    const plan = planRestore(paths, {
      metro: { os: 'linux', staticInputs: { a: '1' } },
    });

    writeKeysFile(paths, plan);

    const filePath = path.join(paths.root, 'keys.json');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath.startsWith(paths.metroTransform)).toBe(false);
    expect(filePath.startsWith(paths.metroFileMap)).toBe(false);

    const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(written.version).toBe(1);
  });

  it('swallows errors instead of throwing when the cache root cannot be created', () => {
    const blockedRoot = path.join(projectRoot, 'blocked-file', 'nested');
    fs.writeFileSync(path.join(projectRoot, 'blocked-file'), 'not a directory');
    const paths = createHarnessCachePaths(blockedRoot);
    const plan = planRestore(paths, {
      metro: { os: 'linux', staticInputs: { a: '1' } },
    });

    expect(() => writeKeysFile(paths, plan)).not.toThrow();
    expect(fs.existsSync(path.join(paths.root, 'keys.json'))).toBe(false);
  });
});
