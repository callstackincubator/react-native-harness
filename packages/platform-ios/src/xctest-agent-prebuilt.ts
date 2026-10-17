import { getHarnessCacheRootPath, logger } from '@react-native-harness/tools';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildXCTestAgent,
  getAgentProjectSourcesHash,
  getXCTestAgentBuildProductsPath,
  resolveXCTestAgentToolchain,
} from './xctest-agent-build.js';
import type {
  XCTestAgentArtifacts,
  XCTestAgentBuildDestination,
  XCTestAgentProvider,
} from './xctest-agent-artifacts.js';

const xctestAgentLogger = logger.child('ios-xctest-agent');

const PREBUILT_DIRNAME = 'xctest-agent-prebuilds';
const PREBUILT_INDEX_NAME = 'index.json';
const PREBUILT_INDEX_SCHEMA_VERSION = 1;
const PREBUILT_CACHE_PREFIX = 'xctest-agent-prebuilt';
const PREBUILT_CACHE_MARKER = 'prebuilt-cache.json';
const XCTEST_PREBUILT_ROOT_ENV = 'HARNESS_IOS_XCTEST_PREBUILT_ROOT';
const XCTEST_SKIP_PREBUILDS_ENV = 'HARNESS_SKIP_XCTEST_PREBUILDS';

/** Build output that never affects a test run but dominates artifact size. */
const STRIPPED_ARTIFACT_SUFFIXES = ['.dSYM', '.swiftmodule', '.bcsymbolmap'];

export type XCTestAgentPrebuiltEntry = {
  /** Version of `@react-native-harness/platform-apple` that packed this artifact. */
  agentVersion: string;
  buildInputsHash: string;
  destination: XCTestAgentBuildDestination;
  /** Directory name under `xctest-agent-prebuilds/`, relative to the index. */
  directoryName: string;
  sdkVersion: string;
  /** Path of the `.xctestrun` inside the artifact's `Build/Products`. */
  xctestrunRelativePath: string;
  xcodeBuild: string;
  xcodeVersion: string;
};

export type XCTestAgentPrebuiltIndex = {
  entries: XCTestAgentPrebuiltEntry[];
  schemaVersion: typeof PREBUILT_INDEX_SCHEMA_VERSION;
};

export type PackXCTestAgentArtifactsOptions = {
  /**
   * Package version the artifacts are published under. Release tooling passes
   * the version being released, because `package.json` is still bumped
   * afterwards; it defaults to the version currently in `package.json`.
   */
  agentVersion?: string;
  destination: XCTestAgentBuildDestination;
  /** Where the packed artifacts land. Defaults to the installed package. */
  packageRoot?: string;
  /** Project anchoring the local build cache. Defaults to the working directory. */
  projectRoot?: string;
  signal?: AbortSignal;
};

export type PackXCTestAgentArtifactsResult = {
  artifactDirectoryPath: string;
  entry: XCTestAgentPrebuiltEntry;
  indexFilePath: string;
};

/**
 * Root of the installed package, which is the directory holding the agent
 * project. Anchored on the project rather than on `../`, because this module
 * runs both as `src/*.ts` through the `development` export and as
 * `dist/*.js`, and those two locations sit a different number of levels from
 * the package root.
 */
export const getPackageRootPath = (): string => {
  return path.dirname(
    fileURLToPath(new URL('../xctest-agent', import.meta.url))
  );
};

export const getPrebuiltRootPath = (
  packageRoot = getPackageRootPath()
): string => path.join(packageRoot, PREBUILT_DIRNAME);

export const getPrebuiltIndexPath = (
  packageRoot = getPackageRootPath()
): string => path.join(getPrebuiltRootPath(packageRoot), PREBUILT_INDEX_NAME);

const getPackageVersion = (): string => {
  const packageJsonPath = path.join(getPackageRootPath(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    version?: string;
  };

  if (!packageJson.version) {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }

  return packageJson.version;
};

/**
 * Root that holds the prebuilt artifact index, and therefore the artifacts
 * themselves. Defaults to the installed package; the environment override
 * points Harness at artifacts packed elsewhere, which is how a repository
 * rehearses the prebuilt path before a release exists.
 */
export const resolvePrebuiltPackageRoot = (): string => {
  const configured = process.env[XCTEST_PREBUILT_ROOT_ENV]?.trim();

  return configured ? path.resolve(configured) : getPackageRootPath();
};

const isPrebuiltEntry = (value: unknown): value is XCTestAgentPrebuiltEntry => {
  const entry = value as Partial<XCTestAgentPrebuiltEntry> | null;

  return (
    typeof entry?.agentVersion === 'string' &&
    typeof entry?.buildInputsHash === 'string' &&
    (entry.destination === 'simulator' || entry.destination === 'device') &&
    typeof entry?.directoryName === 'string' &&
    typeof entry?.sdkVersion === 'string' &&
    typeof entry?.xctestrunRelativePath === 'string' &&
    typeof entry?.xcodeVersion === 'string'
  );
};

export const readPrebuiltIndex = (
  indexPath: string
): XCTestAgentPrebuiltIndex | null => {
  if (!fs.existsSync(indexPath)) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return null;
  }

  const index = parsed as Partial<XCTestAgentPrebuiltIndex>;

  if (
    index.schemaVersion !== PREBUILT_INDEX_SCHEMA_VERSION ||
    !Array.isArray(index.entries) ||
    !index.entries.every(isPrebuiltEntry)
  ) {
    return null;
  }

  return index as XCTestAgentPrebuiltIndex;
};

const writePrebuiltIndex = (
  indexPath: string,
  index: XCTestAgentPrebuiltIndex
) => {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
};

// `cpSync` visits a stripped directory's children individually, so matching
// the directory name alone would recreate the tree and copy its contents.
const shouldCopyArtifactPath = (sourcePath: string): boolean =>
  !sourcePath
    .split(path.sep)
    .some((segment) =>
      STRIPPED_ARTIFACT_SUFFIXES.some((suffix) => segment.endsWith(suffix))
    );

const findXCTestRunRelativePath = (
  buildProductsPath: string
): string | null => {
  if (!fs.existsSync(buildProductsPath)) {
    return null;
  }

  const entry = fs
    .readdirSync(buildProductsPath, { recursive: true })
    .find((value) => typeof value === 'string' && value.endsWith('.xctestrun'));

  return typeof entry === 'string' ? entry : null;
};

const getPrebuiltDirectoryName = (key: {
  buildInputsHash: string;
  destination: XCTestAgentBuildDestination;
  sdkVersion: string;
  xcodeVersion: string;
}): string => {
  const hash = createHash('sha256');
  hash.update(key.destination);
  hash.update('\0');
  hash.update(key.buildInputsHash);
  hash.update('\0');
  hash.update(key.xcodeVersion);
  hash.update('\0');
  hash.update(key.sdkVersion);

  return `${key.destination}-${hash.digest('hex').slice(0, 12)}`;
};

/**
 * Adds prebuilt XCTest agent artifacts to the installed package, so consumers
 * whose toolchain matches never run `xcodebuild build-for-testing`.
 *
 * An artifact is an unsigned `build-for-testing` product tree without debug
 * symbol bundles. It embeds no device, bundle-identity, or checkout path,
 * which is what makes it reusable across machines.
 */
export const packXCTestAgentArtifacts = async (
  options: PackXCTestAgentArtifactsOptions
): Promise<PackXCTestAgentArtifactsResult> => {
  // The destination becomes part of the artifact's identity, and the build
  // arguments fall through to device for anything that is not simulator. A typo
  // would therefore pack a device build under a simulator label and publish it.
  if (options.destination !== 'simulator' && options.destination !== 'device') {
    throw new Error(
      `Unsupported destination '${String(
        options.destination
      )}'. Expected 'simulator' or 'device'.`
    );
  }

  const toolchain = await resolveXCTestAgentToolchain(
    options.destination,
    options.signal
  );
  const buildInputsHash = getAgentProjectSourcesHash();
  const packageRoot = options.packageRoot ?? getPackageRootPath();
  const indexPath = getPrebuiltIndexPath(packageRoot);
  const directoryName = getPrebuiltDirectoryName({
    buildInputsHash,
    destination: options.destination,
    sdkVersion: toolchain.sdkVersion,
    xcodeVersion: toolchain.xcodeVersion,
  });
  const artifactDirectoryPath = path.join(
    getPrebuiltRootPath(packageRoot),
    directoryName
  );

  const buildResult = await buildXCTestAgent({
    destination: options.destination,
    projectRoot: options.projectRoot,
    signal: options.signal,
  });
  const sourceBuildProductsPath = getXCTestAgentBuildProductsPath(
    buildResult.derivedDataPath
  );
  const xctestrunRelativePath = findXCTestRunRelativePath(
    sourceBuildProductsPath
  );

  if (!xctestrunRelativePath) {
    throw new Error(
      `Missing generated .xctestrun file in ${sourceBuildProductsPath}`
    );
  }

  fs.rmSync(artifactDirectoryPath, { recursive: true, force: true });
  fs.cpSync(
    sourceBuildProductsPath,
    path.join(artifactDirectoryPath, 'Build', 'Products'),
    { filter: shouldCopyArtifactPath, recursive: true }
  );

  const entry: XCTestAgentPrebuiltEntry = {
    agentVersion: options.agentVersion ?? getPackageVersion(),
    buildInputsHash,
    destination: options.destination,
    directoryName,
    sdkVersion: toolchain.sdkVersion,
    xctestrunRelativePath,
    xcodeBuild: toolchain.xcodeBuild,
    xcodeVersion: toolchain.xcodeVersion,
  };
  const existing = readPrebuiltIndex(indexPath);
  // One artifact per destination ships with a given package version: it was
  // packed with one Xcode, and consumers on any other are expected to build.
  const entries = (existing?.entries ?? []).filter(
    (candidate) => candidate.destination !== entry.destination
  );

  writePrebuiltIndex(indexPath, {
    entries: [...entries, entry].sort((a, b) =>
      a.directoryName.localeCompare(b.directoryName)
    ),
    schemaVersion: PREBUILT_INDEX_SCHEMA_VERSION,
  });

  xctestAgentLogger.info(
    'Packed prebuilt XCTest agent artifacts for %s (Xcode %s, SDK %s) into %s',
    options.destination,
    entry.xcodeVersion,
    entry.sdkVersion,
    artifactDirectoryPath
  );

  return {
    artifactDirectoryPath,
    entry,
    indexFilePath: indexPath,
  };
};

type UnpackMarker = {
  directoryName: string;
  xctestrunRelativePath: string;
};

const readUnpackMarker = (markerPath: string): UnpackMarker | null => {
  if (!fs.existsSync(markerPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8')) as UnpackMarker;
  } catch {
    return null;
  }
};

/**
 * Copies an artifact out of the package into the project's Harness cache.
 *
 * The copy exists because `test-without-building` writes results and logs
 * into its derived data path, and on a physical device that copy is also
 * re-signed in place, while the installed package is a shared store that must
 * stay pristine. Unpacking happens once per project.
 */
const unpackPrebuiltArtifacts = (
  entry: XCTestAgentPrebuiltEntry,
  artifactDirectoryPath: string,
  projectRoot: string,
  /**
   * Distinguishes caches that must not be shared, such as one re-signed for a
   * particular identity and profile. The packaged artifact itself is never
   * mutated, so the unpacked copy has to be keyed by whatever was signed into it.
   */
  variant?: string
): string => {
  const directoryName = variant
    ? `${entry.directoryName}-${createHash('sha256')
        .update(variant)
        .digest('hex')
        .slice(0, 8)}`
    : entry.directoryName;
  const derivedDataPath = path.join(
    getHarnessCacheRootPath(projectRoot),
    `${PREBUILT_CACHE_PREFIX}-${directoryName}`
  );
  const markerPath = path.join(derivedDataPath, PREBUILT_CACHE_MARKER);
  const marker = readUnpackMarker(markerPath);

  if (
    marker?.directoryName === directoryName &&
    fs.existsSync(
      path.join(
        getXCTestAgentBuildProductsPath(derivedDataPath),
        entry.xctestrunRelativePath
      )
    )
  ) {
    return derivedDataPath;
  }

  fs.mkdirSync(path.dirname(derivedDataPath), { recursive: true });
  fs.rmSync(derivedDataPath, { recursive: true, force: true });
  fs.cpSync(artifactDirectoryPath, derivedDataPath, {
    recursive: true,
  });
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        directoryName,
        xctestrunRelativePath: entry.xctestrunRelativePath,
      } satisfies UnpackMarker,
      null,
      2
    )
  );

  return derivedDataPath;
};

export type PreparedPrebuiltArtifacts = {
  /** Unpacked, unsigned copy of the artifact; safe to modify or re-sign. */
  derivedDataPath: string;
  entry: XCTestAgentPrebuiltEntry;
};

export const toPrebuiltArtifacts = (
  prepared: PreparedPrebuiltArtifacts
): XCTestAgentArtifacts => ({
  launch: {
    derivedDataPath: prepared.derivedDataPath,
    kind: 'xctestrun',
    xctestrunPath: path.join(
      getXCTestAgentBuildProductsPath(prepared.derivedDataPath),
      prepared.entry.xctestrunRelativePath
    ),
  },
  source: 'prebuilt',
});

/**
 * Finds the shipped artifact the local toolchain may use, or returns `null` when
 * none qualifies.
 *
 * Declining rather than failing is deliberate: a toolchain mismatch is the
 * normal case for anyone whose Xcode differs from the release machine's, and
 * the caller's fallback — build locally — is always correct.
 */
export const resolvePrebuiltEntry = async (options: {
  destination: XCTestAgentBuildDestination;
  packageRoot?: string;
  signal?: AbortSignal;
}): Promise<XCTestAgentPrebuiltEntry | null> => {
  if (process.env[XCTEST_SKIP_PREBUILDS_ENV] === '1') {
    xctestAgentLogger.debug(
      '%s is set, ignoring prebuilt XCTest agent artifacts',
      XCTEST_SKIP_PREBUILDS_ENV
    );
    return null;
  }

  const packageRoot = options.packageRoot ?? resolvePrebuiltPackageRoot();
  const index = readPrebuiltIndex(getPrebuiltIndexPath(packageRoot));
  const candidates = index?.entries.filter(
    (candidate) => candidate.destination === options.destination
  );

  if (!candidates?.length) {
    xctestAgentLogger.debug(
      'no prebuilt XCTest agent artifacts shipped for %s',
      options.destination
    );
    return null;
  }

  let toolchain;

  try {
    toolchain = await resolveXCTestAgentToolchain(
      options.destination,
      options.signal
    );
  } catch (error) {
    xctestAgentLogger.debug(
      'skipping prebuilt XCTest agent artifacts, the local toolchain version could not be read: %s',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }

  const buildInputsHash = getAgentProjectSourcesHash();
  const agentVersion = getPackageVersion();
  const entry = candidates.find(
    (candidate) =>
      candidate.buildInputsHash === buildInputsHash &&
      candidate.agentVersion === agentVersion &&
      candidate.xcodeVersion === toolchain.xcodeVersion &&
      candidate.sdkVersion === toolchain.sdkVersion
  );

  if (!entry) {
    xctestAgentLogger.info(
      'Shipped XCTest agent artifacts do not match the local %s toolchain (Xcode %s, SDK %s), building instead',
      options.destination,
      toolchain.xcodeVersion,
      toolchain.sdkVersion
    );
    return null;
  }

  const artifactDirectoryPath = path.join(
    getPrebuiltRootPath(packageRoot),
    entry.directoryName
  );

  if (
    !fs.existsSync(
      path.join(
        getXCTestAgentBuildProductsPath(artifactDirectoryPath),
        entry.xctestrunRelativePath
      )
    )
  ) {
    xctestAgentLogger.warn(
      'Prebuilt XCTest agent artifacts are incomplete at %s, building instead',
      artifactDirectoryPath
    );
    return null;
  }

  return entry;
};

/**
 * Copies a resolved artifact into the project's Harness cache.
 *
 * `variant` separates caches whose contents differ for reasons the artifact key
 * cannot see, such as re-signing for a particular identity. The packaged copy is
 * never modified, so anything written into the unpacked copy has to be part of
 * its directory name.
 */
export const unpackPrebuiltEntry = (
  entry: XCTestAgentPrebuiltEntry,
  options: { packageRoot?: string; projectRoot: string; variant?: string }
): PreparedPrebuiltArtifacts => ({
  derivedDataPath: unpackPrebuiltArtifacts(
    entry,
    path.join(
      getPrebuiltRootPath(options.packageRoot ?? resolvePrebuiltPackageRoot()),
      entry.directoryName
    ),
    options.projectRoot,
    options.variant
  ),
  entry,
});

/**
 * Resolves a usable shipped artifact and copies it into the project cache, or
 * returns `null` when none qualifies.
 */
const preparePrebuiltArtifacts = async (options: {
  destination: XCTestAgentBuildDestination;
  packageRoot?: string;
  projectRoot: string;
  signal?: AbortSignal;
  variant?: string;
}): Promise<PreparedPrebuiltArtifacts | null> => {
  const entry = await resolvePrebuiltEntry(options);

  if (!entry) {
    return null;
  }

  return unpackPrebuiltEntry(entry, options);
};

/**
 * Provider for simulator runs: the shipped artifact is directly runnable, since
 * simulator builds carry no signature.
 */
export const createPrebuiltXCTestAgentProvider = (options?: {
  packageRoot?: string;
}): XCTestAgentProvider => ({
  id: 'prebuilt',
  prepare: async (context) => {
    if (context.destination !== 'simulator') {
      return null;
    }

    const prepared = await preparePrebuiltArtifacts({
      ...options,
      destination: context.destination,
      projectRoot: context.projectRoot,
      signal: context.signal,
    });

    if (!prepared) {
      return null;
    }

    xctestAgentLogger.info(
      'Using prebuilt XCTest agent artifacts for %s target (Xcode %s)',
      context.destination,
      prepared.entry.xcodeVersion
    );

    return toPrebuiltArtifacts(prepared);
  },
});
