import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createResourceLockManager,
  hashResourceLockKey,
} from '../resource-lock.js';

describe('resource lock manager', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'react-native-harness-resource-lock-test-')
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
      'ios:simulator:iPhone 17 Pro:26.2'
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

    const queueDir = path.join(rootDir, hashResourceLockKey(key), 'queue');
    const queuedEntries = await fs.readdir(queueDir);
    expect(queuedEntries).toHaveLength(0);

    await firstLease.release();
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
    const manager = createResourceLockManager({
      rootDir,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 20,
      staleLockTimeoutMs: 50,
      isProcessActive: () => false,
    });
    const key = 'web:browser:chromium';
    const keyDir = path.join(rootDir, hashResourceLockKey(key));
    const queueDir = path.join(keyDir, 'queue');
    const ownerFilePath = path.join(keyDir, 'owner.json');

    await fs.mkdir(queueDir, { recursive: true });
    await fs.writeFile(
      ownerFilePath,
      JSON.stringify({
        ticketId: 'stale-owner',
        key,
        pid: 999999,
        createdAt: Date.now() - 1000,
        heartbeatAt: Date.now() - 1000,
      }),
      'utf8'
    );

    const lease = await manager.acquire(key);
    const owner = JSON.parse(await fs.readFile(ownerFilePath, 'utf8')) as {
      ticketId: string;
    };
    expect(owner.ticketId).not.toBe('stale-owner');

    await lease.release();
  });
});
