import { getHarnessCacheRootPath, logger } from '@react-native-harness/tools';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  getAgentProjectSourcesHash,
  getXCTestAgentBuildProductsPath,
  resolveXCTestAgentToolchain,
  runXCTestAgentBuild,
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

/**
 * Oldest Xcode major version a shipped artifact is used with.
 *
 * Artifacts do not need the exact Xcode they were packed with: the agent
 * targets iOS 15, the runner gets its XCTest frameworks either embedded and
 * re-signed or from the running Xcode, and artifacts packed with Xcode 26.4.1
 * and 27.0 were each verified to run under the other on simulators and
 * devices. Older Xcodes are untested, and so is any major version newer than
 * the one that packed the artifact; both build locally instead.
 */
const MIN_PREBUILT_XCODE_MAJOR_VERSION = 26;

const getXcodeMajorVersion = (xcodeVersion: string): number =>
  Number.parseInt(xcodeVersion, 10);

/**
 * Whether an artifact may run under the local Xcode: from the oldest supported
 * major version up to the major version that packed it. A newer Xcode may change
 * the `.xctestrun` format or the test runner protocol, so it builds locally
 * until a release packs an artifact with it.
 */
const supportsXcode = (
  entry: XCTestAgentPrebuiltEntry,
  xcodeVersion: string
): boolean => {
  const localMajorVersion = getXcodeMajorVersion(xcodeVersion);

  return (
    localMajorVersion >= MIN_PREBUILT_XCODE_MAJOR_VERSION &&
    localMajorVersion <= getXcodeMajorVersion(entry.xcodeVersion)
  );
};

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
 * on a supported Xcode never run `xcodebuild build-for-testing`.
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

  // A fresh derived data folder, never a cached local build: a cache in this
  // checkout may hold products signed with the packer's own identity and
  // profile, and those must not reach a published package.
  const derivedDataPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'harness-xctest-pack-')
  );

  try {
    const xctestrunRelativePath = await runXCTestAgentBuild({
      derivedDataPath,
      destination: options.destination,
      signal: options.signal,
    });

    fs.rmSync(artifactDirectoryPath, { recursive: true, force: true });
    fs.cpSync(
      getXCTestAgentBuildProductsPath(derivedDataPath),
      path.join(artifactDirectoryPath, 'Build', 'Products'),
      { filter: shouldCopyArtifactPath, recursive: true }
    );
    assertArtifactIsAnonymous(artifactDirectoryPath, [
      derivedDataPath,
      getPackageRootPath(),
      packageRoot,
      os.homedir(),
    ]);

    return writePackedEntry({
      agentVersion: options.agentVersion,
      artifactDirectoryPath,
      buildInputsHash,
      destination: options.destination,
      directoryName,
      indexPath,
      toolchain,
      xctestrunRelativePath,
    });
  } catch (error) {
    fs.rmSync(artifactDirectoryPath, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(derivedDataPath, { recursive: true, force: true });
  }
};

const writePackedEntry = (options: {
  agentVersion?: string;
  artifactDirectoryPath: string;
  buildInputsHash: string;
  destination: XCTestAgentBuildDestination;
  directoryName: string;
  indexPath: string;
  toolchain: { sdkVersion: string; xcodeBuild: string; xcodeVersion: string };
  xctestrunRelativePath: string;
}): PackXCTestAgentArtifactsResult => {
  const { toolchain } = options;
  const entry: XCTestAgentPrebuiltEntry = {
    agentVersion: options.agentVersion ?? getPackageVersion(),
    buildInputsHash: options.buildInputsHash,
    destination: options.destination,
    directoryName: options.directoryName,
    sdkVersion: toolchain.sdkVersion,
    xctestrunRelativePath: options.xctestrunRelativePath,
    xcodeBuild: toolchain.xcodeBuild,
    xcodeVersion: toolchain.xcodeVersion,
  };
  const existing = readPrebuiltIndex(options.indexPath);
  // One artifact per destination: it serves every supported Xcode, so packing
  // again replaces it rather than adding a sibling.
  const entries = (existing?.entries ?? []).filter(
    (candidate) => candidate.destination !== entry.destination
  );

  const index: XCTestAgentPrebuiltIndex = {
    entries: [...entries, entry].sort((a, b) =>
      a.directoryName.localeCompare(b.directoryName)
    ),
    schemaVersion: PREBUILT_INDEX_SCHEMA_VERSION,
  };

  writePrebuiltIndex(options.indexPath, index);
  removeUnindexedArtifacts(path.dirname(options.indexPath), index);

  xctestAgentLogger.info(
    'Packed prebuilt XCTest agent artifacts for %s (Xcode %s, SDK %s) into %s',
    options.destination,
    entry.xcodeVersion,
    entry.sdkVersion,
    options.artifactDirectoryPath
  );

  return {
    artifactDirectoryPath: options.artifactDirectoryPath,
    entry,
    indexFilePath: options.indexPath,
  };
};

/**
 * Deletes artifact directories the index no longer names. Packing replaces the
 * entry for a destination, so without this a directory packed by an earlier
 * Xcode would stay on disk and ship in the tarball as dead weight.
 */
const removeUnindexedArtifacts = (
  prebuiltRootPath: string,
  index: XCTestAgentPrebuiltIndex
) => {
  const indexed = new Set(index.entries.map((entry) => entry.directoryName));

  for (const entry of fs.readdirSync(prebuiltRootPath, {
    withFileTypes: true,
  })) {
    if (entry.isDirectory() && !indexed.has(entry.name)) {
      fs.rmSync(path.join(prebuiltRootPath, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
};

const listFiles = (root: string): string[] =>
  fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));

// Team that signs the `XCTRunner` host Xcode copies into every test runner.
const APPLE_TEAM_IDENTIFIER = '59GAB85EFG';

/**
 * Fails the pack when an artifact carries anything tied to the machine or the
 * Apple Developer account it was packed on.
 *
 * Releases are packed on a maintainer's machine, so a signed product, an
 * embedded profile, or an absolute path would publish their identity with the
 * package. The build flags already keep these out; this check is what makes
 * that a guarantee instead of an assumption about Xcode's defaults.
 */
const assertArtifactIsAnonymous = (
  artifactDirectoryPath: string,
  hostPaths: string[]
) => {
  const needles = [
    ...new Set(
      hostPaths.flatMap((hostPath) => [hostPath, fs.realpathSync(hostPath)])
    ),
  ].map((needle) => Buffer.from(needle));
  const problems: string[] = [];

  for (const filePath of listFiles(artifactDirectoryPath)) {
    const relativePath = path.relative(artifactDirectoryPath, filePath);

    if (filePath.endsWith('.mobileprovision') || filePath.endsWith('.xcent')) {
      problems.push(`${relativePath} is signing material`);
      continue;
    }

    const contents = fs.readFileSync(filePath);

    if (needles.some((needle) => contents.includes(needle))) {
      problems.push(`${relativePath} embeds a path from this machine`);
    }
  }

  for (const bundlePath of fs
    .readdirSync(artifactDirectoryPath, {
      recursive: true,
      withFileTypes: true,
    })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name.endsWith('.app') || entry.name.endsWith('.xctest'))
    )
    .map((entry) => path.join(entry.parentPath, entry.name))) {
    const signature = spawnSync('codesign', ['-dv', bundlePath], {
      encoding: 'utf8',
    });
    const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(signature.stderr)?.[1];

    if (
      teamIdentifier &&
      teamIdentifier !== 'not set' &&
      teamIdentifier !== APPLE_TEAM_IDENTIFIER
    ) {
      problems.push(
        `${path.relative(
          artifactDirectoryPath,
          bundlePath
        )} is signed by team ${teamIdentifier}`
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to pack XCTest agent artifacts that identify this machine or account:\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`
    );
  }
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

const isUnpacked = (
  derivedDataPath: string,
  directoryName: string,
  entry: XCTestAgentPrebuiltEntry
): boolean =>
  readUnpackMarker(path.join(derivedDataPath, PREBUILT_CACHE_MARKER))
    ?.directoryName === directoryName &&
  fs.existsSync(
    path.join(
      getXCTestAgentBuildProductsPath(derivedDataPath),
      entry.xctestrunRelativePath
    )
  );

/**
 * Copies an artifact out of the package into the project's Harness cache.
 *
 * The copy exists because `test-without-building` writes results and logs
 * into its derived data path, and on a physical device that copy is also
 * re-signed, while the installed package is a shared store that must stay
 * pristine. Unpacking happens once per project and variant.
 *
 * The copy is assembled in a staging directory, finished by `prepare`, marked,
 * and only then renamed into place. A run that is interrupted mid-signing, or
 * two runners unpacking the same variant at once, therefore never leave or
 * observe a half-prepared copy.
 */
const unpackPrebuiltArtifacts = async (options: {
  artifactDirectoryPath: string;
  entry: XCTestAgentPrebuiltEntry;
  prepare?: (derivedDataPath: string) => Promise<void>;
  projectRoot: string;
  /**
   * Distinguishes caches that must not be shared, such as one re-signed for a
   * particular identity and profile. The packaged artifact itself is never
   * mutated, so the unpacked copy has to be keyed by whatever was signed into it.
   */
  variant?: string;
}): Promise<string> => {
  const { entry } = options;
  const directoryName = options.variant
    ? `${entry.directoryName}-${createHash('sha256')
        .update(options.variant)
        .digest('hex')
        .slice(0, 8)}`
    : entry.directoryName;
  const derivedDataPath = path.join(
    getHarnessCacheRootPath(options.projectRoot),
    `${PREBUILT_CACHE_PREFIX}-${directoryName}`
  );

  if (isUnpacked(derivedDataPath, directoryName, entry)) {
    return derivedDataPath;
  }

  const stagingPath = `${derivedDataPath}.staging-${process.pid}-${Date.now()}`;

  try {
    fs.mkdirSync(path.dirname(derivedDataPath), { recursive: true });
    fs.cpSync(options.artifactDirectoryPath, stagingPath, { recursive: true });
    await options.prepare?.(stagingPath);
    fs.writeFileSync(
      path.join(stagingPath, PREBUILT_CACHE_MARKER),
      JSON.stringify(
        {
          directoryName,
          xctestrunRelativePath: entry.xctestrunRelativePath,
        } satisfies UnpackMarker,
        null,
        2
      )
    );

    // Another runner may have finished the same variant meanwhile; its copy
    // is equivalent, so keep it rather than replacing a directory in use.
    if (isUnpacked(derivedDataPath, directoryName, entry)) {
      return derivedDataPath;
    }

    fs.rmSync(derivedDataPath, { recursive: true, force: true });
    fs.renameSync(stagingPath, derivedDataPath);

    return derivedDataPath;
  } finally {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
};

export type PreparedPrebuiltArtifacts = {
  /** Project-local copy of the artifact, already through `prepare`. */
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
 * Declining rather than failing is deliberate: an Xcode older than the
 * supported minimum, or a package whose agent sources were changed locally, is
 * expected, and the caller's fallback — build locally — is always correct.
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
  const current = candidates.filter(
    (candidate) =>
      candidate.buildInputsHash === buildInputsHash &&
      candidate.agentVersion === agentVersion
  );

  if (current.length === 0) {
    xctestAgentLogger.info(
      'Shipped XCTest agent artifacts were packed from different agent sources, building instead'
    );
    return null;
  }

  const entry = current.find((candidate) =>
    supportsXcode(candidate, toolchain.xcodeVersion)
  );

  if (!entry) {
    xctestAgentLogger.info(
      'Shipped XCTest agent artifacts support Xcode %d up to Xcode %s, found Xcode %s, building instead',
      MIN_PREBUILT_XCODE_MAJOR_VERSION,
      current
        .map((candidate) => getXcodeMajorVersion(candidate.xcodeVersion))
        .sort((a, b) => b - a)[0],
      toolchain.xcodeVersion
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
 * Copies a resolved artifact into the project's Harness cache, running
 * `prepare` on the copy before it becomes visible.
 *
 * `variant` separates caches whose contents differ for reasons the artifact key
 * cannot see, such as re-signing for a particular identity. The packaged copy is
 * never modified, so anything `prepare` writes has to be part of the variant.
 */
export const unpackPrebuiltEntry = async (
  entry: XCTestAgentPrebuiltEntry,
  options: {
    packageRoot?: string;
    prepare?: (derivedDataPath: string) => Promise<void>;
    projectRoot: string;
    variant?: string;
  }
): Promise<PreparedPrebuiltArtifacts> => ({
  derivedDataPath: await unpackPrebuiltArtifacts({
    artifactDirectoryPath: path.join(
      getPrebuiltRootPath(options.packageRoot ?? resolvePrebuiltPackageRoot()),
      entry.directoryName
    ),
    entry,
    prepare: options.prepare,
    projectRoot: options.projectRoot,
    variant: options.variant,
  }),
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
}): Promise<PreparedPrebuiltArtifacts | null> => {
  const entry = await resolvePrebuiltEntry(options);

  if (!entry) {
    return null;
  }

  return await unpackPrebuiltEntry(entry, options);
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
