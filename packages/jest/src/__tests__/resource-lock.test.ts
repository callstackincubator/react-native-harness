import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResourceLockManager } from '../resource-lock.js';

type ReaddirOptions = {
  withFileTypes?: boolean;
};

const { mockFs } = vi.hoisted(() => {
  const directories = new Set<string>();
  const files = new Map<string, string>();

  const normalizePath = (value: unknown): string => {
    const normalized = String(value).replace(/\/+$/g, '');
    return normalized === '' ? '/' : normalized;
  };

  const getParentDir = (filePath: string): string => {
    const normalized = normalizePath(filePath);
    const index = normalized.lastIndexOf('/');

    if (index <= 0) {
      return '/';
    }

    return normalized.slice(0, index);
  };

  const createFsError = (code: string, targetPath: string) =>
    Object.assign(new Error(`${code}: ${targetPath}`), {
      code,
      path: targetPath,
    });

  const ensureDirectory = (directoryPath: string): void => {
    const normalized = normalizePath(directoryPath);
    const parts = normalized.split('/').filter(Boolean);
    let current = normalized.startsWith('/') ? '/' : '';

    directories.add(current || '.');

    for (const part of parts) {
      current =
        current === '/' || current === ''
          ? `${current}${part}`
          : `${current}/${part}`;
      directories.add(current);
    }
  };

  const listChildren = (directoryPath: string) => {
    const normalized = normalizePath(directoryPath);
    const prefix = normalized === '/' ? '/' : `${normalized}/`;
    const childNames = new Set<string>();

    for (const directory of directories) {
      if (directory === normalized || !directory.startsWith(prefix)) {
        continue;
      }

      const rest = directory.slice(prefix.length);
      const [name] = rest.split('/');
      if (name) childNames.add(name);
    }

    for (const filePath of files.keys()) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }

      const rest = filePath.slice(prefix.length);
      const [name] = rest.split('/');
      if (name) childNames.add(name);
    }

    return [...childNames].sort();
  };

  const removePath = (targetPath: string, recursive: boolean): void => {
    const normalized = normalizePath(targetPath);

    files.delete(normalized);

    if (recursive) {
      const prefix = normalized === '/' ? '/' : `${normalized}/`;
      for (const filePath of [...files.keys()]) {
        if (filePath.startsWith(prefix)) {
          files.delete(filePath);
        }
      }
      for (const directory of [...directories]) {
        if (directory === normalized || directory.startsWith(prefix)) {
          directories.delete(directory);
        }
      }
      return;
    }

    directories.delete(normalized);
  };

  directories.add('/');

  const writeFileRaw = async (
    filePath: unknown,
    data: unknown,
    options?: unknown
  ) => {
    const normalized = normalizePath(filePath);
    const parentDir = getParentDir(normalized);

    if (!directories.has(parentDir)) {
      throw createFsError('ENOENT', normalized);
    }

    const flag =
      options !== null && typeof options === 'object' && 'flag' in options
        ? options.flag
        : undefined;
    if (flag === 'wx' && files.has(normalized)) {
      throw createFsError('EEXIST', normalized);
    }

    files.set(normalized, String(data));
  };

  const api = {
    reset: () => {
      files.clear();
      directories.clear();
      directories.add('/');
    },
    mkdir: vi.fn(async (directoryPath: string) => {
      ensureDirectory(directoryPath);
    }),
    readFile: vi.fn(async (filePath: string) => {
      const normalized = normalizePath(filePath);
      const value = files.get(normalized);

      if (value === undefined) {
        throw createFsError('ENOENT', normalized);
      }

      return value;
    }),
    writeFile: vi.fn(writeFileRaw),
    writeFileRaw,
    rename: vi.fn(async (source: string, destination: string) => {
      const normalizedSource = normalizePath(source);
      const normalizedDestination = normalizePath(destination);
      const value = files.get(normalizedSource);

      if (value === undefined) {
        throw createFsError('ENOENT', normalizedSource);
      }

      if (!directories.has(getParentDir(normalizedDestination))) {
        throw createFsError('ENOENT', normalizedDestination);
      }

      files.delete(normalizedSource);
      files.set(normalizedDestination, value);
    }),
    rm: vi.fn(
      async (
        targetPath: string,
        options?: { recursive?: boolean; force?: boolean }
      ) => {
        const normalized = normalizePath(targetPath);
        const exists = files.has(normalized) || directories.has(normalized);

        if (!exists && !options?.force) {
          throw createFsError('ENOENT', normalized);
        }

        removePath(normalized, options?.recursive ?? false);
      }
    ),
    readdir: vi.fn(async (directoryPath: string, options?: ReaddirOptions) => {
      const normalized = normalizePath(directoryPath);

      if (!directories.has(normalized)) {
        throw createFsError('ENOENT', normalized);
      }

      const childNames = listChildren(normalized);

      if (options?.withFileTypes) {
        return childNames.map((name) => {
          const childPath =
            normalized === '/' ? `/${name}` : `${normalized}/${name}`;

          return {
            name,
            isFile: () => files.has(childPath),
            isDirectory: () => directories.has(childPath),
          };
        });
      }

      return childNames;
    }),
  };

  return { mockFs: api };
});

vi.mock('node:fs/promises', () => ({
  default: mockFs,
  ...mockFs,
}));

describe('resource lock manager', () => {
  let rootDir: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFs.reset();
    rootDir = '/tmp/react-native-harness-resource-lock-test';
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
    const writeFileSpy = vi
      .spyOn(fs, 'writeFile')
      .mockImplementation(async (file, data, options) => {
        // Delay atomic temp-file writes to simulate overlapping heartbeat flushes.
        if (
          typeof file === 'string' &&
          file.startsWith(rootDir) &&
          file.endsWith('.tmp')
        ) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }

        return await mockFs.writeFileRaw(file, data, options);
      });

    try {
      const lease = await manager.acquire(key);

      // Discover the owner file after acquire creates the key directory.
      const [keyDirName] = await fs.readdir(rootDir);
      const ownerFilePath = path.join(rootDir, keyDirName, 'owner.json');

      const initialOwner = JSON.parse(
        await fs.readFile(ownerFilePath, 'utf8')
      ) as ResourceLockOwner;

      await new Promise((resolve) => setTimeout(resolve, 80));

      for (let index = 0; index < 5; index += 1) {
        const owner = JSON.parse(
          await fs.readFile(ownerFilePath, 'utf8')
        ) as ResourceLockOwner;
        expect(owner.ticketId).toBe(initialOwner.ticketId);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      await lease.release();
      await new Promise((resolve) => setTimeout(resolve, 40));
    } finally {
      writeFileSpy.mockRestore();
    }
  });
});

type ResourceLockOwner = {
  ticketId: string;
};
