import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResourceLockManager } from '../resource-lock.js';

describe('resource lock manager', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'react-native-harness-resource-lock-test-'),
    );
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('queues access in FIFO order', async () => {
    const manager = createResourceLockManager({
      rootDir,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 20,
      staleLockTimeoutMs: 200,
    });
    const order: string[] = [];

    const firstLease = await manager.acquire(
      'ios:simulator:iPhone 17 Pro:26.2',
    );
    const secondAcquire = manager
      .acquire('ios:simulator:iPhone 17 Pro:26.2', {
        onWait: () => {
          order.push('waiting');
        },
      })
      .then(async (lease) => {
        order.push('acquired');
        await lease.release();
      });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual(['waiting']);

    await firstLease.release();
    await secondAcquire;

    expect(order).toEqual(['waiting', 'acquired']);
  });

  it('removes the queued ticket when waiting is aborted', async () => {
    const manager = createResourceLockManager({
      rootDir,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 20,
      staleLockTimeoutMs: 200,
    });
    const key = 'android:emulator:Pixel_8_API_35';
    const firstLease = await manager.acquire(key);
    const controller = new AbortController();

    const acquirePromise = manager.acquire(key, {
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();

    await expect(acquirePromise).rejects.toMatchObject({
      name: 'AbortError',
    });

    // The aborted waiter must have cleaned up its ticket. Verify by releasing
    // the first lock and confirming a fresh acquire completes immediately.
    await firstLease.release();
    const cleanupLease = await manager.acquire(key);
    await cleanupLease.release();
  });

  it('keeps queued tickets alive while the waiting process is still active', async () => {
    const manager = createResourceLockManager({
      rootDir,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 20,
      staleLockTimeoutMs: 30,
      isProcessActive: () => true,
    });
    const key = 'ios:simulator:iPhone 17 Pro:26.2';
    const firstLease = await manager.acquire(key);

    const secondAcquire = manager.acquire(key);

    await new Promise((resolve) => setTimeout(resolve, 80));

    await firstLease.release();
    const secondLease = await secondAcquire;
    await secondLease.release();
  });

  it('reclaims a stale owner before granting the lock', async () => {
    const key = 'web:browser:chromium';

    // Simulate a live process holding the lock.
    const manager1 = createResourceLockManager({
      rootDir,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 20,
    });
    const staleLease = await manager1.acquire(key);

    // A second manager whose isProcessActive always returns false will consider
    // any owner — including the live one above — immediately stale and reclaim it.
    const manager2 = createResourceLockManager({
      rootDir,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 20,
      staleLockTimeoutMs: 50,
      isProcessActive: () => false,
    });

    const lease = await manager2.acquire(key);
    await lease.release();

    // manager1 was evicted; its release is best-effort.
    await staleLease.release();
  });

  it('keeps owner metadata valid when heartbeat writes overlap', async () => {
    const manager = createResourceLockManager({
      rootDir,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 10,
      staleLockTimeoutMs: 200,
    });
    const key = 'ios:simulator:iPhone 17 Pro:26.2';
    const actualWriteFile = fs.writeFile.bind(fs);
    const writeFileSpy = vi
      .spyOn(fs, 'writeFile')
      .mockImplementation(async (file, data, options) => {
        // Delay atomic temp-file writes to simulate overlapping heartbeat flushes.
        if (typeof file === 'string' && file.startsWith(rootDir) && file.endsWith('.tmp')) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }

        return await actualWriteFile(file, data, options);
      });

    try {
      const lease = await manager.acquire(key);

      // Discover the owner file after acquire creates the key directory.
      const [keyDirName] = await fs.readdir(rootDir);
      const ownerFilePath = path.join(rootDir, keyDirName, 'owner.json');

      const initialOwner = JSON.parse(
        await fs.readFile(ownerFilePath, 'utf8'),
      ) as ResourceLockOwner;

      await new Promise((resolve) => setTimeout(resolve, 80));

      for (let index = 0; index < 5; index += 1) {
        const owner = JSON.parse(
          await fs.readFile(ownerFilePath, 'utf8'),
        ) as ResourceLockOwner;
        expect(owner.ticketId).toBe(initialOwner.ticketId);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      await lease.release();
    } finally {
      writeFileSpy.mockRestore();
    }
  });
});

type ResourceLockOwner = {
  ticketId: string;
};
