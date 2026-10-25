import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { connectToHarness } from '../client.js';
import { createHarnessBridge, type HarnessBridge } from '../server.js';

const png = (color: number) => {
  const image = new PNG({ width: 2, height: 2 });
  image.data.fill(color);
  return new Uint8Array(PNG.sync.write(image));
};

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false
  );

describe('received screenshot cleanup', () => {
  let bridge: HarnessBridge;
  let handle: Awaited<ReturnType<typeof connectToHarness>>;
  let dir: string;
  let testFile: string;
  const snapshotDir = () => path.join(dir, '__image_snapshots__', 'ios');

  const transfer = (color: number) =>
    handle.transferScreenshot(png(color), { width: 2, height: 2 });
  const match = (file: { path: string }, name = 'shot') =>
    handle.matchImageSnapshot(file, testFile, { name }, 'ios');

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-cleanup-'));
    testFile = path.join(dir, 'a.harness.ts');
    bridge = await createHarnessBridge({
      port: 0,
      context: {
        platform: {
          name: 'ios',
          platformId: 'ios',
          runner: '/dev/null',
          config: {},
        },
      },
    } as Parameters<typeof createHarnessBridge>[0]);
    const port = (bridge.ws.address() as { port: number }).port;
    handle = await connectToHarness(`ws://127.0.0.1:${port}`, {
      runTests: vi.fn(),
      resetEnvironment: vi.fn(),
    });
    const ready = bridge.nextConnection();
    handle.reportReady({
      platform: 'ios',
      manufacturer: 'Apple',
      model: 'iPhone',
      osVersion: '18.0',
    });
    await ready;
  });

  afterEach(async () => {
    handle.disconnect();
    bridge.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('removes the file after a successful match', async () => {
    const file = await transfer(255);
    expect(await exists(file.path)).toBe(true);
    expect((await match(file)).pass).toBe(true);
    expect(await exists(file.path)).toBe(false);
  });

  it('removes the file after a failed match and keeps the actual image', async () => {
    await match(await transfer(255));
    const file = await transfer(0);
    expect((await match(file)).pass).toBe(false);
    expect(await exists(file.path)).toBe(false);
    const actual = await fs.stat(
      path.join(snapshotDir(), '__diff_output__', 'shot-actual.png')
    );
    expect(actual.size).toBeGreaterThan(0);
  });

  it('removes the file when the comparison throws', async () => {
    await fs.mkdir(snapshotDir(), { recursive: true });
    await fs.writeFile(path.join(snapshotDir(), 'shot.png'), 'not a png');
    const file = await transfer(255);
    await expect(match(file)).rejects.toThrow();
    expect(await exists(file.path)).toBe(false);
  });

  it('does not delete a path the bridge did not create', async () => {
    const foreign = path.join(dir, 'foreign.png');
    await fs.writeFile(foreign, png(255));
    await match({ path: foreign });
    expect(await exists(foreign)).toBe(true);
  });

  it('removes screenshots that were never compared on dispose', async () => {
    const file = await transfer(255);
    bridge.dispose();
    await vi.waitFor(async () => expect(await exists(file.path)).toBe(false));
  });
});
