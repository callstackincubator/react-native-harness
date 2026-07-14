import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@react-native-harness/tools';
import { getDomainDirectories } from './paths.js';
import type { CacheDomainId, HarnessCachePaths } from './paths.js';

const cacheLogger = logger.child('cache');

const KEYS_FILENAME = 'keys.json';
const HASH_LENGTH = 16;

export interface CacheKeyInputs {
  os: string;
  staticInputs: Record<string, string>;
}

export interface DomainRestorePlan {
  paths: string[];
  restoreKey: string;
  restorePrefixes: string[];
  accretive: boolean;
}

export interface RestorePlan {
  version: 1;
  domains: Partial<Record<CacheDomainId, DomainRestorePlan>>;
}

export interface CacheSnapshotEntry {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
}

export type CacheSnapshot = Partial<Record<CacheDomainId, CacheSnapshotEntry[]>>;

export interface SavePolicy {
  mode: 'default-branch' | 'always' | 'never';
  isDefaultBranch: boolean;
}

export interface DomainSavePlan {
  shouldSave: boolean;
  saveKey: string;
  delta: {
    addedEntries: number;
    removedEntries: number;
    addedBytes: number;
  };
}

export interface SavePlan {
  version: 1;
  domains: Partial<Record<CacheDomainId, DomainSavePlan>>;
}

const ALL_DOMAINS: readonly CacheDomainId[] = ['metro'];

/**
 * Accretive domains only ever grow (transform/file-map caches keyed by
 * content hash) so a save is always safe to key off the static hash plus a
 * content hash, and prior saves can be found via a prefix match on the
 * static hash. Non-accretive domains would need an exact key match instead.
 * A domain not yet handled here defaults to non-accretive (exact-match),
 * matching the safe-fallback style of `getDomainDirectories`/
 * `getWarmthDirectory`: prefix-matching into an unknown domain's saves would
 * not be a neutral no-op, so the conservative default is to require an exact
 * key match rather than silently opt a future domain into accretive lookup.
 */
const isAccretiveDomain = (domain: CacheDomainId): boolean => {
  switch (domain) {
    case 'metro':
      return true;
    default:
      return false;
  }
};

const hashSortedEntries = (entries: Array<[string, string]>): string =>
  createHash('sha256')
    .update(
      entries
        .slice()
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
    )
    .digest('hex')
    .slice(0, HASH_LENGTH);

const buildStaticHashKey = (
  domain: CacheDomainId,
  inputs: CacheKeyInputs
): string => {
  const hash = hashSortedEntries(Object.entries(inputs.staticInputs));
  return `harness-${domain}-${inputs.os}-${hash}`;
};

const buildContentHash = (entries: CacheSnapshotEntry[]): string =>
  hashSortedEntries(
    entries.map((entry) => [entry.path, String(entry.sizeBytes)])
  );

const walkDirectory = (
  root: string,
  directory: string,
  entries: CacheSnapshotEntry[]
): void => {
  let dirents: fs.Dirent[];

  try {
    dirents = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    // Missing/unreadable directory is treated as empty rather than an error.
    return;
  }

  for (const dirent of dirents) {
    const fullPath = path.join(directory, dirent.name);

    if (dirent.isDirectory()) {
      walkDirectory(root, fullPath, entries);
    } else if (dirent.isFile()) {
      const stat = fs.statSync(fullPath);
      entries.push({
        path: path.relative(root, fullPath),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }
};

export const planRestore = (
  paths: HarnessCachePaths,
  inputs: Partial<Record<CacheDomainId, CacheKeyInputs>>
): RestorePlan => {
  const domains: RestorePlan['domains'] = {};

  for (const domain of ALL_DOMAINS) {
    const domainInputs = inputs[domain];
    if (!domainInputs) {
      continue;
    }

    const restoreKey = buildStaticHashKey(domain, domainInputs);
    const accretive = isAccretiveDomain(domain);

    domains[domain] = {
      paths: [...getDomainDirectories(domain, paths)],
      restoreKey,
      restorePrefixes: accretive ? [`${restoreKey}-`] : [],
      accretive,
    };
  }

  return { version: 1, domains };
};

/**
 * Synchronous snapshot of on-disk cache contents, keyed by domain. Never
 * throws: a domain whose directories cannot be read is reported as empty.
 */
export const snapshot = (paths: HarnessCachePaths): CacheSnapshot => {
  const result: CacheSnapshot = {};

  for (const domain of ALL_DOMAINS) {
    try {
      const entries: CacheSnapshotEntry[] = [];
      for (const directory of getDomainDirectories(domain, paths)) {
        walkDirectory(paths.root, directory, entries);
      }
      result[domain] = entries;
    } catch (error) {
      cacheLogger.warn(
        `Failed to snapshot cache domain "${domain}". Treating as empty.`,
        error
      );
      result[domain] = [];
    }
  }

  return result;
};

const diffSnapshots = (
  before: CacheSnapshotEntry[],
  after: CacheSnapshotEntry[]
): DomainSavePlan['delta'] => {
  const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.map((entry) => [entry.path, entry]));

  let addedEntries = 0;
  let removedEntries = 0;
  let addedBytes = 0;

  for (const [entryPath, afterEntry] of afterByPath) {
    const beforeEntry = beforeByPath.get(entryPath);
    if (!beforeEntry || beforeEntry.sizeBytes !== afterEntry.sizeBytes) {
      addedEntries += 1;
      addedBytes += afterEntry.sizeBytes;
    }
  }

  for (const entryPath of beforeByPath.keys()) {
    if (!afterByPath.has(entryPath)) {
      removedEntries += 1;
    }
  }

  return { addedEntries, removedEntries, addedBytes };
};

const shouldSaveForPolicy = (
  policy: SavePolicy,
  delta: DomainSavePlan['delta']
): boolean => {
  if (delta.addedEntries + delta.removedEntries === 0) {
    return false;
  }

  switch (policy.mode) {
    case 'always':
      return true;
    case 'default-branch':
      return policy.isDefaultBranch;
    case 'never':
      return false;
  }
};

export const planSave = (
  paths: HarnessCachePaths,
  before: CacheSnapshot,
  policy: SavePolicy,
  inputs: Partial<Record<CacheDomainId, CacheKeyInputs>>
): SavePlan => {
  const after = snapshot(paths);
  const domains: SavePlan['domains'] = {};

  for (const domain of ALL_DOMAINS) {
    const domainInputs = inputs[domain];
    if (!domainInputs) {
      continue;
    }

    const beforeEntries = before[domain] ?? [];
    const afterEntries = after[domain] ?? [];
    const delta = diffSnapshots(beforeEntries, afterEntries);
    const staticHashKey = buildStaticHashKey(domain, domainInputs);
    const accretive = isAccretiveDomain(domain);

    domains[domain] = {
      shouldSave: shouldSaveForPolicy(policy, delta),
      saveKey: accretive
        ? `${staticHashKey}-${buildContentHash(afterEntries)}`
        : staticHashKey,
      delta,
    };
  }

  return { version: 1, domains };
};

/**
 * Written to `<cache-root>/keys.json`, outside any domain's cached
 * subdirectories, so it is never itself part of what gets restored/saved.
 * It is a secondary/debug artifact; the actual data flow between CI steps
 * goes through GITHUB_OUTPUT, not by re-reading this file. Cache I/O must
 * never fail a run, so write failures are logged and swallowed.
 */
export const writeKeysFile = (
  paths: HarnessCachePaths,
  plan: RestorePlan | SavePlan
): void => {
  const filePath = path.join(paths.root, KEYS_FILENAME);

  try {
    fs.mkdirSync(paths.root, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(plan, null, 2));
  } catch (error) {
    cacheLogger.warn(`Failed to write cache keys file "${filePath}".`, error);
  }
};
