import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { matchImageSnapshot } from '../image-snapshot.js';

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
      'ios'
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
});
