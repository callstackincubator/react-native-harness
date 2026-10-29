import fs, { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchImageSnapshot } from '../image-snapshot.js';

const createPng = ({ width = 2, height = 2, fill = 255 } = {}): Buffer => {
  const png = new PNG({ width, height });
  png.data.fill(fill);
  return PNG.sync.write(png);
};

describe('matchImageSnapshot', () => {
  let directory: string;
  let testFilePath: string;
  let receivedPath: string;
  let snapshotPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(os.tmpdir(), 'harness-image-snapshot-')
    );
    testFilePath = path.join(directory, 'screen.harness.tsx');
    receivedPath = path.join(directory, 'received.png');
    snapshotPath = path.join(
      directory,
      '__image_snapshots__',
      'android',
      'square.png'
    );
    await writeFile(receivedPath, createPng());
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  const diffOutputPath = (file: string): string =>
    path.join(path.dirname(snapshotPath), '__diff_output__', file);

  it('writes a missing snapshot and passes when new snapshots may be written', async () => {
    const result = await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'new'
    );

    expect(result.pass).toBe(true);
    expect(await readFile(snapshotPath)).toEqual(await readFile(receivedPath));
    expect(existsSync(diffOutputPath('square-actual.png'))).toBe(false);
  });

  it('writes a missing snapshot and passes when snapshots are updated', async () => {
    const result = await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'all'
    );

    expect(result.pass).toBe(true);
    expect(await readFile(snapshotPath)).toEqual(await readFile(receivedPath));
    expect(existsSync(diffOutputPath('square-actual.png'))).toBe(false);
  });

  it('fails a missing snapshot without writing it in CI mode, and saves the received image to __diff_output__', async () => {
    const actualPath = diffOutputPath('square-actual.png');

    const result = await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'none'
    );

    expect(result.pass).toBe(false);
    expect(result.message).toContain(
      `New snapshot was not written: ${snapshotPath} does not exist`
    );
    expect(result.message).toContain(`Received image saved at ${actualPath}`);
    expect(existsSync(snapshotPath)).toBe(false);
    expect(await readFile(actualPath)).toEqual(await readFile(receivedPath));
  });

  it('compares an existing snapshot in CI mode', async () => {
    await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'new'
    );

    const result = await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'none'
    );

    expect(result).toEqual({ pass: true, message: 'Images match' });
    expect(existsSync(diffOutputPath('square-actual.png'))).toBe(false);
    expect(existsSync(diffOutputPath('square-diff.png'))).toBe(false);
  });

  it('saves the diff and received images of a mismatch to __diff_output__', async () => {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, createPng({ fill: 0 }));

    const result = await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'square' },
      'android',
      'none'
    );

    expect(result.pass).toBe(false);
    expect(await readFile(diffOutputPath('square-actual.png'))).toEqual(
      await readFile(receivedPath)
    );
    expect(existsSync(diffOutputPath('square-diff.png'))).toBe(true);
  });

  it('names the received image of a missing snapshot after the whole snapshot name', async () => {
    await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'logo.png-dark' },
      'android',
      'none'
    );

    expect(existsSync(diffOutputPath('logo.png-dark-actual.png'))).toBe(true);
  });

  it('names the images of a mismatch after the whole snapshot name', async () => {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(
      path.join(path.dirname(snapshotPath), 'logo.png-dark.png'),
      createPng({ fill: 0 })
    );

    await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'logo.png-dark' },
      'android',
      'none'
    );

    expect(existsSync(diffOutputPath('logo.png-dark-actual.png'))).toBe(true);
    expect(existsSync(diffOutputPath('logo.png-dark-diff.png'))).toBe(true);
  });
});

const solid = (r: number, g: number, b: number) => {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
};

describe('matchImageSnapshot failure output', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-snapshot-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes diff and actual images to __diff_output__ without touching sibling baselines', async () => {
    const testFile = path.join(dir, 'a.harness.ts');
    const snapshotsDir = path.join(dir, '__image_snapshots__', 'ios');
    await fs.mkdir(snapshotsDir, { recursive: true });

    const baseline = solid(255, 0, 0);
    const siblingBaseline = solid(0, 0, 255);
    await fs.writeFile(path.join(snapshotsDir, 'code.png'), baseline);
    await fs.writeFile(
      path.join(snapshotsDir, 'code-diff.png'),
      siblingBaseline
    );
    await fs.writeFile(
      path.join(snapshotsDir, 'code-actual.png'),
      siblingBaseline
    );

    const received = path.join(dir, 'received.png');
    const receivedBuffer = solid(0, 255, 0);
    await fs.writeFile(received, receivedBuffer);

    const result = await matchImageSnapshot(
      { path: received },
      testFile,
      { name: 'code' },
      'ios',
      'new'
    );

    const outDir = path.join(snapshotsDir, '__diff_output__');
    expect(result.pass).toBe(false);
    expect(result.message).toContain(path.join(outDir, 'code-diff.png'));
    expect(result.message).toContain(path.join(outDir, 'code-actual.png'));
    expect(await fs.readFile(path.join(outDir, 'code-actual.png'))).toEqual(
      receivedBuffer
    );
    await fs.access(path.join(outDir, 'code-diff.png'));
    expect(await fs.readFile(path.join(snapshotsDir, 'code-diff.png'))).toEqual(
      siblingBaseline
    );
    expect(
      await fs.readFile(path.join(snapshotsDir, 'code-actual.png'))
    ).toEqual(siblingBaseline);
  });

  it('saves the received image to __diff_output__ when dimensions differ', async () => {
    const testFile = path.join(dir, 'a.harness.ts');
    const snapshotsDir = path.join(dir, '__image_snapshots__', 'ios');
    await fs.mkdir(snapshotsDir, { recursive: true });

    const baseline = new PNG({ width: 4, height: 4 });
    await fs.writeFile(
      path.join(snapshotsDir, 'box.png'),
      PNG.sync.write(baseline)
    );

    const received = path.join(dir, 'received.png');
    const receivedBuffer = PNG.sync.write(new PNG({ width: 4, height: 6 }));
    await fs.writeFile(received, receivedBuffer);

    const result = await matchImageSnapshot(
      { path: received },
      testFile,
      { name: 'box' },
      'ios',
      'new'
    );

    const actualPath = path.join(
      snapshotsDir,
      '__diff_output__',
      'box-actual.png'
    );
    expect(result.pass).toBe(false);
    expect(result.message).toContain('Images have different dimensions');
    expect(result.message).toContain(`Actual image saved at ${actualPath}.`);
    expect(await fs.readFile(actualPath)).toEqual(receivedBuffer);
  });
});
