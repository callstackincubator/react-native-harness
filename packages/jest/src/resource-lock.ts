import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger, type HarnessLogger } from '@react-native-harness/tools';

const resourceLockLogger = logger.child('resource-lock');

const DEFAULT_ROOT_DIR = path.join(os.tmpdir(), 'react-native-harness-locks');
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2000;
const DEFAULT_STALE_LOCK_TIMEOUT_MS = 15000;

type ResourceLockMetadata = {
  ticketId: string;
  key: string;
  pid: number;
  createdAt: number;
  heartbeatAt: number;
};

export type ResourceLockAcquireOptions = {
  signal?: AbortSignal;
  onWait?: () => void;
  onStillWaiting?: (elapsedMs: number) => void;
};

export type ResourceLease = {
  release: () => Promise<void>;
};

export type ResourceLockManager = {
  acquire: (
    key: string,
    options?: ResourceLockAcquireOptions
  ) => Promise<ResourceLease>;
};

type ResourceLockManagerOptions = {
  rootDir?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  staleLockTimeoutMs?: number;
  pid?: number;
  logger?: HarnessLogger;
  isProcessActive?: (pid: number) => boolean;
};

type LockPaths = {
  rootDir: string;
  keyDir: string;
  queueDir: string;
  ownerFilePath: string;
};

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const createAbortError = () =>
  new DOMException('The operation was aborted', 'AbortError');

export const hashResourceLockKey = (key: string): string => {
  return crypto.createHash('sha256').update(key).digest('hex');
};

const getPathsForKey = (rootDir: string, key: string): LockPaths => {
  const keyDir = path.join(rootDir, hashResourceLockKey(key));
  return {
    rootDir,
    keyDir,
    queueDir: path.join(keyDir, 'queue'),
    ownerFilePath: path.join(keyDir, 'owner.json'),
  };
};

const createTicketId = (createdAt: number, pid: number): string => {
  return `${createdAt
    .toString()
    .padStart(16, '0')}-${pid}-${crypto.randomUUID()}`;
};

const isMissingFileError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'ENOENT'
  );
};

const isExclusiveCreateError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'EEXIST'
  );
};

const ensureLockDirectories = async (paths: LockPaths): Promise<void> => {
  await fs.mkdir(paths.queueDir, { recursive: true });
};

const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
};

const removeFileIfPresent = async (filePath: string): Promise<void> => {
  try {
    await fs.rm(filePath, { force: true });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
};

const isPidActive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code === 'ESRCH'
    );
  }
};

const isMetadataStale = (
  metadata: ResourceLockMetadata,
  now: number,
  staleLockTimeoutMs: number,
  isProcessActive: (pid: number) => boolean
): boolean => {
  if (!isProcessActive(metadata.pid)) {
    return true;
  }

  return now - metadata.heartbeatAt > staleLockTimeoutMs;
};

const isQueuedTicketStale = (
  metadata: ResourceLockMetadata,
  isProcessActive: (pid: number) => boolean
): boolean => {
  return !isProcessActive(metadata.pid);
};

const waitForPollInterval = (
  ms: number,
  signal?: AbortSignal
): Promise<void> => {
  if (!signal) {
    return wait(ms);
  }

  if (signal.aborted) {
    return Promise.reject(signal.reason ?? createAbortError());
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const readQueueTickets = async (
  queueDir: string
): Promise<ResourceLockMetadata[]> => {
  const ticketEntries = await fs.readdir(queueDir, { withFileTypes: true });
  const tickets = await Promise.all(
    ticketEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => ({
        name: entry.name,
        metadata: await readJsonFile<ResourceLockMetadata>(
          path.join(queueDir, entry.name)
        ),
      }))
  );

  return tickets
    .filter(
      (entry): entry is { name: string; metadata: ResourceLockMetadata } =>
        entry.metadata !== null
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => entry.metadata);
};

const cleanupQueue = async (options: {
  paths: LockPaths;
  currentTicketId: string;
  logger: HarnessLogger;
  isProcessActive: (pid: number) => boolean;
}): Promise<ResourceLockMetadata[]> => {
  const { paths, currentTicketId, logger, isProcessActive } = options;
  const tickets = await readQueueTickets(paths.queueDir);
  const activeTickets: ResourceLockMetadata[] = [];

  for (const ticket of tickets) {
    const isCurrentTicket = ticket.ticketId === currentTicketId;
    const isStale =
      !isCurrentTicket && isQueuedTicketStale(ticket, isProcessActive);

    if (isStale) {
      logger.debug(
        'removing stale queued ticket %s for key %s',
        ticket.ticketId,
        ticket.key
      );
      await removeFileIfPresent(
        path.join(paths.queueDir, `${ticket.ticketId}.json`)
      );
      continue;
    }

    activeTickets.push(ticket);
  }

  return activeTickets;
};

const maybeClearStaleOwner = async (options: {
  ownerFilePath: string;
  staleLockTimeoutMs: number;
  now: number;
  logger: HarnessLogger;
  isProcessActive: (pid: number) => boolean;
}): Promise<ResourceLockMetadata | null> => {
  const { ownerFilePath, staleLockTimeoutMs, now, logger, isProcessActive } =
    options;
  const owner = await readJsonFile<ResourceLockMetadata>(ownerFilePath);

  if (!owner) {
    return null;
  }

  if (!isMetadataStale(owner, now, staleLockTimeoutMs, isProcessActive)) {
    return owner;
  }

  logger.debug(
    'removing stale owner ticket %s for key %s',
    owner.ticketId,
    owner.key
  );
  await removeFileIfPresent(ownerFilePath);
  return null;
};

const claimOwnership = async (
  ownerFilePath: string,
  metadata: ResourceLockMetadata
): Promise<boolean> => {
  try {
    await fs.writeFile(ownerFilePath, JSON.stringify(metadata), {
      encoding: 'utf8',
      flag: 'wx',
    });
    return true;
  } catch (error) {
    if (isExclusiveCreateError(error)) {
      return false;
    }

    throw error;
  }
};

export const createResourceLockManager = (
  options: ResourceLockManagerOptions = {}
): ResourceLockManager => {
  const rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const staleLockTimeoutMs =
    options.staleLockTimeoutMs ?? DEFAULT_STALE_LOCK_TIMEOUT_MS;
  const pid = options.pid ?? process.pid;
  const scopedLogger = options.logger ?? resourceLockLogger;
  const isProcessActive = options.isProcessActive ?? isPidActive;

  return {
    acquire: async (key, acquireOptions = {}) => {
      const paths = getPathsForKey(rootDir, key);
      await ensureLockDirectories(paths);

      const createdAt = Date.now();
      const ticketId = createTicketId(createdAt, pid);
      const ticketPath = path.join(paths.queueDir, `${ticketId}.json`);
      const metadata: ResourceLockMetadata = {
        ticketId,
        key,
        pid,
        createdAt,
        heartbeatAt: createdAt,
      };

      await fs.writeFile(ticketPath, JSON.stringify(metadata), 'utf8');
      scopedLogger.debug('queued ticket %s for key %s', ticketId, key);

      let heartbeatTimer: NodeJS.Timeout | null = null;
      let released = false;
      let didNotifyWait = false;
      const waitStartedAt = Date.now();

      const release = async () => {
        if (released) {
          return;
        }

        released = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

        const owner = await readJsonFile<ResourceLockMetadata>(
          paths.ownerFilePath
        );
        if (owner?.ticketId === ticketId) {
          await removeFileIfPresent(paths.ownerFilePath);
        }

        await removeFileIfPresent(ticketPath);
        scopedLogger.debug('released ticket %s for key %s', ticketId, key);
      };

      const startHeartbeat = () => {
        heartbeatTimer = setInterval(async () => {
          const nextHeartbeatAt = Date.now();
          const owner = await readJsonFile<ResourceLockMetadata>(
            paths.ownerFilePath
          );

          if (released || owner?.ticketId !== ticketId) {
            return;
          }

          const nextMetadata: ResourceLockMetadata = {
            ...owner,
            heartbeatAt: nextHeartbeatAt,
          };

          if (released) {
            return;
          }

          await fs.writeFile(
            paths.ownerFilePath,
            JSON.stringify(nextMetadata),
            'utf8'
          );
          scopedLogger.debug('refreshed heartbeat for ticket %s', ticketId);
        }, heartbeatIntervalMs);
        heartbeatTimer.unref?.();
      };

      try {
        while (true) {
          acquireOptions.signal?.throwIfAborted();

          const now = Date.now();
          const activeTickets = await cleanupQueue({
            paths,
            currentTicketId: ticketId,
            logger: scopedLogger,
            isProcessActive,
          });
          const ownIndex = activeTickets.findIndex(
            (entry) => entry.ticketId === ticketId
          );

          if (ownIndex === -1) {
            throw new Error(
              `Queued ticket ${ticketId} disappeared before acquisition.`
            );
          }

          const owner = await maybeClearStaleOwner({
            ownerFilePath: paths.ownerFilePath,
            staleLockTimeoutMs,
            now,
            logger: scopedLogger,
            isProcessActive,
          });

          if (ownIndex === 0 && owner === null) {
            const claimed = await claimOwnership(paths.ownerFilePath, {
              ...metadata,
              heartbeatAt: Date.now(),
            });

            if (claimed) {
              await removeFileIfPresent(ticketPath);
              startHeartbeat();
              scopedLogger.debug(
                'acquired lock for key %s with ticket %s',
                key,
                ticketId
              );
              return { release };
            }
          }

          if (!didNotifyWait) {
            didNotifyWait = true;
            acquireOptions.onWait?.();
          }

          acquireOptions.onStillWaiting?.(Date.now() - waitStartedAt);
          scopedLogger.debug(
            'waiting for key %s with ticket %s at queue position %d',
            key,
            ticketId,
            ownIndex + 1
          );

          await waitForPollInterval(pollIntervalMs, acquireOptions.signal);
        }
      } catch (error) {
        await release();
        throw error;
      }
    },
  };
};
