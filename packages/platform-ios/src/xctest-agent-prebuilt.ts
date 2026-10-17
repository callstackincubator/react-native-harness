import { logger } from '@react-native-harness/tools';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const HARNESS_DIRNAME = '.harness';
const CACHE_DIRNAME = 'cache';
const XCTEST_PREBUILT_ROOT_ENV = 'HARNESS_IOS_XCTEST_PREBUILT_ROOT';

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

type BuildModule = typeof import('./xctest-agent-build.js');

let buildModulePromise: Promise<BuildModule> | undefined;

// Loaded lazily so consumers that never touch prebuilt artifacts do not pay
// for the build module's imports.
const loadBuildModule = async (): Promise<BuildModule> =>
  (buildModulePromise ??= import('./xctest-agent-build.js'));

/**
 * Root of the installed package, which is the directory holding the agent
 * project. Anchored on the project rather than on `../`, because this module
 * runs both as `src/*.ts` through the `development` export and as
 * `dist/*.js`, and those two locations sit a different number of levels from
 * the package root.
 */
export const getPackageRootPath = (): string => {
  return path.dirname(fileURLToPath(new URL('../xctest-agent', import.meta.url)));
};

export const getPrebuiltRootPath = (
  packageRoot = getPackageRootPath()
): string => path.join(packageRoot, PREBUILT_DIRNAME);

export const getPrebuiltIndexPath = (
  packageRoot = getPackageRootPath()
): string => path.join(getPrebuiltRootPath(packageRoot), PREBUILT_INDEX_NAME);

const getPackageVersion = (): string => {
  const packageJsonPath = path.join(getPackageRootPath(), 'package.json');
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, 'utf8')
  ) as { version?: string };

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

const findXCTestRunRelativePath = (buildProductsPath: string): string | null => {
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
  const build = await loadBuildModule();
  const toolchain = await build.resolveXCTestAgentToolchain(
    options.destination,
    options.signal
  );
  const buildInputsHash = build.getAgentProjectSourcesHash();
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

  const buildResult = await build.buildXCTestAgent({
    destination: options.destination,
    projectRoot: options.projectRoot,
    signal: options.signal,
  });
  const sourceBuildProductsPath = build.getXCTestAgentBuildProductsPath(
    buildResult.derivedDataPath
  );
  const xctestrunRelativePath =
    findXCTestRunRelativePath(sourceBuildProductsPath);

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

const getPrebuiltCachePath = (
  entry: XCTestAgentPrebuiltEntry,
  projectRoot: string
): string =>
  path.join(
    projectRoot,
    HARNESS_DIRNAME,
    CACHE_DIRNAME,
    `${PREBUILT_CACHE_PREFIX}-${entry.directoryName}`
  );

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
 * into its derived data path, while the installed package is a shared store
 * that must stay pristine. Unpacking happens once per project.
 */
const unpackPrebuiltArtifacts = (
  build: BuildModule,
  entry: XCTestAgentPrebuiltEntry,
  artifactDirectoryPath: string,
  projectRoot: string
): string => {
  const derivedDataPath = getPrebuiltCachePath(entry, projectRoot);
  const markerPath = path.join(derivedDataPath, PREBUILT_CACHE_MARKER);
  const marker = readUnpackMarker(markerPath);

  if (
    marker?.directoryName === entry.directoryName &&
    fs.existsSync(
      path.join(
        build.getXCTestAgentBuildProductsPath(derivedDataPath),
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
        directoryName: entry.directoryName,
        xctestrunRelativePath: entry.xctestrunRelativePath,
      } satisfies UnpackMarker,
      null,
      2
    )
  );

  return derivedDataPath;
};

/**
 * Primary provider: uses artifacts shipped inside the installed package.
 *
 * It declines whenever the local toolchain differs from the one that packed
 * the artifact, which leaves `build-for-testing` as the fallback rather than
 * launching a binary the local Xcode may not accept.
 */
export const createPrebuiltXCTestAgentProvider = (options?: {
  packageRoot?: string;
}): XCTestAgentProvider => ({
  id: 'prebuilt',
  prepare: async (context) => {
    const packageRoot = options?.packageRoot ?? resolvePrebuiltPackageRoot();
    const index = readPrebuiltIndex(getPrebuiltIndexPath(packageRoot));
    const candidates = index?.entries.filter(
      (candidate) => candidate.destination === context.destination
    );

    if (!candidates?.length) {
      xctestAgentLogger.debug(
        'no prebuilt XCTest agent artifacts shipped for %s',
        context.destination
      );
      return null;
    }

    const build = await loadBuildModule();
    let toolchain;

    try {
      toolchain = await build.resolveXCTestAgentToolchain(
        context.destination,
        context.signal
      );
    } catch (error) {
      xctestAgentLogger.debug(
        'skipping prebuilt XCTest agent artifacts, the local toolchain version could not be read: %s',
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }

    const buildInputsHash = build.getAgentProjectSourcesHash();
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
        context.destination,
        toolchain.xcodeVersion,
        toolchain.sdkVersion
      );
      return null;
    }

    const artifactDirectoryPath = path.join(
      getPrebuiltRootPath(packageRoot),
      entry.directoryName
    );
    const packagedXCTestRunPath = path.join(
      build.getXCTestAgentBuildProductsPath(artifactDirectoryPath),
      entry.xctestrunRelativePath
    );

    if (!fs.existsSync(packagedXCTestRunPath)) {
      xctestAgentLogger.warn(
        'Prebuilt XCTest agent artifacts are incomplete at %s, building instead',
        artifactDirectoryPath
      );
      return null;
    }

    const derivedDataPath = unpackPrebuiltArtifacts(
      build,
      entry,
      artifactDirectoryPath,
      context.projectRoot
    );

    xctestAgentLogger.info(
      'Using prebuilt XCTest agent artifacts for %s target (Xcode %s)',
      context.destination,
      entry.xcodeVersion
    );

    const artifacts: XCTestAgentArtifacts = {
      launch: {
        derivedDataPath,
        kind: 'xctestrun',
        xctestrunPath: path.join(
          build.getXCTestAgentBuildProductsPath(derivedDataPath),
          entry.xctestrunRelativePath
        ),
      },
      source: 'prebuilt',
    };

    return artifacts;
  },
});
