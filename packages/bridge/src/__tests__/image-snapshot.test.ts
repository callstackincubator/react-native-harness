import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    expect(
      existsSync(path.join(path.dirname(snapshotPath), 'square-actual.png'))
    ).toBe(false);
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
    expect(
      existsSync(path.join(path.dirname(snapshotPath), 'square-actual.png'))
    ).toBe(false);
  });

  it('fails a missing snapshot without writing it in CI mode, and saves the received image beside it', async () => {
    const actualPath = path.join(
      path.dirname(snapshotPath),
      'square-actual.png'
    );

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
    expect(
      existsSync(path.join(path.dirname(snapshotPath), 'square-actual.png'))
    ).toBe(false);
    expect(
      existsSync(path.join(path.dirname(snapshotPath), 'square-diff.png'))
    ).toBe(false);
  });

  it('saves the diff and received images of a mismatch beside the snapshot', async () => {
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
    expect(
      await readFile(path.join(path.dirname(snapshotPath), 'square-actual.png'))
    ).toEqual(await readFile(receivedPath));
    expect(
      existsSync(path.join(path.dirname(snapshotPath), 'square-diff.png'))
    ).toBe(true);
  });

  it('names the received image of a missing snapshot after the whole snapshot name', async () => {
    await matchImageSnapshot(
      { path: receivedPath },
      testFilePath,
      { name: 'logo.png-dark' },
      'android',
      'none'
    );

    expect(
      existsSync(
        path.join(path.dirname(snapshotPath), 'logo.png-dark-actual.png')
      )
    ).toBe(true);
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

    expect(
      existsSync(
        path.join(path.dirname(snapshotPath), 'logo.png-dark-actual.png')
      )
    ).toBe(true);
    expect(
      existsSync(
        path.join(path.dirname(snapshotPath), 'logo.png-dark-diff.png')
      )
    ).toBe(true);
  });
});
