import {
  getHarnessCacheRootPath,
  logger,
  spawn,
} from '@react-native-harness/tools';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  XCTestAgentBuildDestination,
  XCTestAgentBuildSigning,
  XCTestAgentProvider,
} from './xctest-agent-artifacts.js';

const xctestAgentLogger = logger.child('ios-xctest-agent');

export const XCTEST_AGENT_PROJECT_NAME = 'HarnessXCTestAgent';
export const XCTEST_AGENT_SCHEME_NAME = 'HarnessXCTestAgent';

const HARNESS_DIRNAME = '.harness';
const XCTEST_AGENT_BUILD_DIRNAME = 'xctest-agent';
const XCTEST_AGENT_SIMULATOR_CACHE_ARTIFACT = 'xctest-agent-simulator';
const XCTEST_AGENT_SIMULATOR_CACHE_SCHEMA_VERSION = 1;

export type BuildXCTestAgentOptions = {
  destination: XCTestAgentBuildDestination;
  signing?: XCTestAgentBuildSigning;
  projectRoot?: string;
  signal?: AbortSignal;
};

export type BuildXCTestAgentResult = {
  destination: XCTestAgentBuildDestination;
  derivedDataPath: string;
  reused: boolean;
  xctestrunPath?: string;
};

type XCTestAgentBuildManifest = {
  buildInputsHash: string;
  destinationKind: XCTestAgentBuildDestination;
  signing?: XCTestAgentBuildSigning;
};

type SimulatorXCTestAgentCacheManifest = {
  artifactName: typeof XCTEST_AGENT_SIMULATOR_CACHE_ARTIFACT;
  buildInputsHash: string;
  destinationKind: 'simulator';
  hostArchitecture: string;
  schemaVersion: typeof XCTEST_AGENT_SIMULATOR_CACHE_SCHEMA_VERSION;
  simulatorSdkVersion: string;
  xcodeVersion: string;
  xctestrunRelativePath: string;
};

type SimulatorXCTestAgentCacheContext = Omit<
  SimulatorXCTestAgentCacheManifest,
  'artifactName' | 'destinationKind' | 'schemaVersion' | 'xctestrunRelativePath'
>;

export const getXCTestAgentProjectRoot = (): string => {
  return fileURLToPath(new URL('../xctest-agent', import.meta.url));
};

export const getXCTestAgentProjectFilePath = (): string => {
  return path.join(
    getXCTestAgentProjectRoot(),
    `${XCTEST_AGENT_PROJECT_NAME}.xcodeproj`
  );
};

const assertXCTestAgentProjectExists = () => {
  const projectFilePath = getXCTestAgentProjectFilePath();

  if (fs.existsSync(projectFilePath)) {
    return;
  }

  throw new Error(
    `Missing checked-in XCTest agent project at ${projectFilePath}. Include the checked-in project in the package artifact.`
  );
};

const getXCTestAgentBuildRoot = (projectRoot = process.cwd()): string => {
  return path.join(projectRoot, HARNESS_DIRNAME, XCTEST_AGENT_BUILD_DIRNAME);
};

const getXCTestAgentCacheRoot = (projectRoot = process.cwd()): string => {
  return getHarnessCacheRootPath(projectRoot);
};

export const getXCTestAgentDerivedDataPath = (
  destination: XCTestAgentBuildDestination,
  projectRoot = process.cwd()
): string => {
  return path.join(getXCTestAgentBuildRoot(projectRoot), destination);
};

const getXCTestAgentBuildDestination = (
  destination: XCTestAgentBuildDestination
): string => {
  if (destination === 'simulator') {
    return 'generic/platform=iOS Simulator';
  }

  return 'generic/platform=iOS';
};

const getXCTestAgentBuildSigningArgs = (
  destination: XCTestAgentBuildDestination,
  signing?: XCTestAgentBuildSigning
): string[] => {
  if (destination === 'simulator') {
    return [
      'CODE_SIGNING_ALLOWED=NO',
      'CODE_SIGNING_REQUIRED=NO',
      'CODE_SIGN_IDENTITY=',
      'DEVELOPMENT_TEAM=',
    ];
  }

  if (!signing) {
    return ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO'];
  }

  const args: string[] = [];

  if (signing.teamId) {
    args.push('CODE_SIGN_STYLE=Automatic');
    args.push(`DEVELOPMENT_TEAM=${signing.teamId}`);

    if (signing.signingIdentity) {
      args.push(`CODE_SIGN_IDENTITY=${signing.signingIdentity}`);
    } else {
      args.push('CODE_SIGN_IDENTITY=Apple Development');
    }
  } else if (signing.signingIdentity) {
    args.push(`CODE_SIGN_IDENTITY=${signing.signingIdentity}`);
  }

  if (signing.provisioningProfile) {
    args.push(`PROVISIONING_PROFILE_SPECIFIER=${signing.provisioningProfile}`);
  }

  return args;
};

export const getXCTestAgentBuildProductsPath = (
  derivedDataPath: string
): string => path.join(derivedDataPath, 'Build', 'Products');

const getXCTestAgentBuildManifestPath = (derivedDataPath: string): string =>
  path.join(derivedDataPath, 'build-manifest.json');

const getXCTestAgentCacheManifestPath = (derivedDataPath: string): string =>
  path.join(derivedDataPath, 'cache.json');

const readBuildManifest = (
  derivedDataPath: string
): XCTestAgentBuildManifest | null => {
  const manifestPath = getXCTestAgentBuildManifestPath(derivedDataPath);

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  ) as XCTestAgentBuildManifest;
};

const writeBuildManifest = (
  derivedDataPath: string,
  manifest: XCTestAgentBuildManifest
) => {
  fs.mkdirSync(derivedDataPath, { recursive: true });
  fs.writeFileSync(
    getXCTestAgentBuildManifestPath(derivedDataPath),
    JSON.stringify(manifest, null, 2)
  );
};

// Local and editor state that never ships in the package. Hashing it would give
// a checkout that opened the project in Xcode a different digest from the
// installed package, so packed artifacts would never be recognised.
const IGNORED_PROJECT_ENTRIES = new Set([
  '.DS_Store',
  '.gitignore',
  'build',
  'xcuserdata',
]);

const getProjectInputFilePaths = (root: string): string[] => {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (IGNORED_PROJECT_ENTRIES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...getProjectInputFilePaths(entryPath));
      continue;
    }

    files.push(entryPath);
  }

  return files.sort();
};

const getBuildInputsSourceFilePath = (): string => {
  return fileURLToPath(import.meta.url);
};

/**
 * Fingerprint of the checked-in agent project sources.
 *
 * These files ship verbatim inside the package, so the digest is the same in
 * the repository and in an installed package. That is what lets artifacts
 * packed at release time be recognised by a consumer.
 */
export const getAgentProjectSourcesHash = (): string => {
  const projectRoot = getXCTestAgentProjectRoot();
  const hash = createHash('sha256');

  for (const filePath of getProjectInputFilePaths(projectRoot)) {
    hash.update(path.relative(projectRoot, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  return hash.digest('hex');
};

/**
 * Fingerprint used for local build reuse: the agent sources plus the build
 * logic that turns them into artifacts. Includes this module's own source, so
 * a change to the build arguments invalidates a previously cached build.
 */
export const getProjectInputsHash = (): string => {
  const hash = createHash('sha256');
  hash.update(getAgentProjectSourcesHash());
  hash.update('\0');

  const sourceFilePath = getBuildInputsSourceFilePath();
  hash.update(path.basename(sourceFilePath));
  hash.update('\0');
  hash.update(fs.readFileSync(sourceFilePath));
  hash.update('\0');

  return hash.digest('hex');
};

const getXCTestRunRelativePath = (derivedDataPath: string): string | null => {
  const buildProductsPath = getXCTestAgentBuildProductsPath(derivedDataPath);

  if (!fs.existsSync(buildProductsPath)) {
    return null;
  }

  const entries = fs.readdirSync(buildProductsPath, { recursive: true });
  const xctestrunEntry = entries.find(
    (entry) => typeof entry === 'string' && entry.endsWith('.xctestrun')
  );

  return typeof xctestrunEntry === 'string' ? xctestrunEntry : null;
};

const readSimulatorBuildManifest = (
  derivedDataPath: string
): SimulatorXCTestAgentCacheManifest | null => {
  const manifestPath = getXCTestAgentCacheManifestPath(derivedDataPath);

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  ) as Partial<SimulatorXCTestAgentCacheManifest>;

  if (
    manifest.schemaVersion !== XCTEST_AGENT_SIMULATOR_CACHE_SCHEMA_VERSION ||
    manifest.artifactName !== XCTEST_AGENT_SIMULATOR_CACHE_ARTIFACT ||
    manifest.destinationKind !== 'simulator' ||
    typeof manifest.buildInputsHash !== 'string' ||
    typeof manifest.hostArchitecture !== 'string' ||
    typeof manifest.simulatorSdkVersion !== 'string' ||
    typeof manifest.xcodeVersion !== 'string' ||
    typeof manifest.xctestrunRelativePath !== 'string'
  ) {
    return null;
  }

  return manifest as SimulatorXCTestAgentCacheManifest;
};

const writeSimulatorBuildManifest = (
  derivedDataPath: string,
  manifest: SimulatorXCTestAgentCacheManifest
) => {
  fs.mkdirSync(derivedDataPath, { recursive: true });
  fs.writeFileSync(
    getXCTestAgentCacheManifestPath(derivedDataPath),
    JSON.stringify(manifest, null, 2)
  );
};

const getSimulatorCacheDirectoryName = (
  context: SimulatorXCTestAgentCacheContext
): string => {
  const hash = createHash('sha256');
  hash.update(XCTEST_AGENT_SIMULATOR_CACHE_ARTIFACT);
  hash.update('\0');
  hash.update(String(XCTEST_AGENT_SIMULATOR_CACHE_SCHEMA_VERSION));
  hash.update('\0');
  hash.update(context.buildInputsHash);
  hash.update('\0');
  hash.update(context.hostArchitecture);
  hash.update('\0');
  hash.update(context.simulatorSdkVersion);
  hash.update('\0');
  hash.update(context.xcodeVersion);

  return `${XCTEST_AGENT_SIMULATOR_CACHE_ARTIFACT}-${hash
    .digest('hex')
    .slice(0, 12)}`;
};

const getSimulatorCacheDerivedDataPath = (
  context: SimulatorXCTestAgentCacheContext,
  projectRoot = process.cwd()
): string => {
  return path.join(
    getXCTestAgentCacheRoot(projectRoot),
    getSimulatorCacheDirectoryName(context)
  );
};

const getHarnessCacheDirectories = (projectRoot = process.cwd()): string[] => {
  const cacheRoot = getXCTestAgentCacheRoot(projectRoot);

  if (!fs.existsSync(cacheRoot)) {
    return [];
  }

  return fs
    .readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(cacheRoot, entry.name))
    .sort();
};

const isCompatibleSimulatorBuildManifest = (
  manifest: SimulatorXCTestAgentCacheManifest,
  context: SimulatorXCTestAgentCacheContext
): boolean => {
  return (
    manifest.buildInputsHash === context.buildInputsHash &&
    manifest.hostArchitecture === context.hostArchitecture &&
    manifest.simulatorSdkVersion === context.simulatorSdkVersion &&
    manifest.xcodeVersion === context.xcodeVersion
  );
};

const findReusableSimulatorBuildArtifacts = (
  context: SimulatorXCTestAgentCacheContext,
  projectRoot = process.cwd()
): string | null => {
  for (const derivedDataPath of getHarnessCacheDirectories(projectRoot)) {
    const manifest = readSimulatorBuildManifest(derivedDataPath);

    if (!manifest || !isCompatibleSimulatorBuildManifest(manifest, context)) {
      continue;
    }

    const buildProductsPath = getXCTestAgentBuildProductsPath(derivedDataPath);

    if (
      fs.existsSync(buildProductsPath) &&
      fs.existsSync(
        path.join(buildProductsPath, manifest.xctestrunRelativePath)
      )
    ) {
      return derivedDataPath;
    }
  }

  return null;
};

const getCurrentXcodeVersion = async (
  signal?: AbortSignal
): Promise<string> => {
  const { stdout } = await spawn('xcodebuild', ['-version'], { signal });
  return stdout.trim();
};

const getCurrentSimulatorSdkVersion = async (
  signal?: AbortSignal
): Promise<string> => {
  const { stdout } = await spawn(
    'xcodebuild',
    ['-version', '-sdk', 'iphonesimulator', 'SDKVersion'],
    { signal }
  );
  return stdout.trim();
};

export type XCTestAgentToolchain = {
  sdkVersion: string;
  xcodeBuild: string;
  xcodeVersion: string;
};

const SDK_PLATFORM_NAMES: Record<XCTestAgentBuildDestination, string> = {
  device: 'iPhoneOS',
  simulator: 'iPhoneSimulator',
};

/**
 * Reads the toolchain from the files `xcodebuild -version` itself reports from:
 * the selected Xcode's `version.plist` and the SDK's `SDKSettings.json`.
 *
 * Every iOS run resolves the toolchain before it can use a shipped artifact,
 * and the two `xcodebuild` invocations cost about a second together, while
 * these reads take a few milliseconds. `xcode-select -p` honours
 * `DEVELOPER_DIR`, so the same Xcode is selected either way.
 */
const readXCTestAgentToolchain = async (
  destination: XCTestAgentBuildDestination,
  signal?: AbortSignal
): Promise<XCTestAgentToolchain> => {
  const { stdout } = await spawn('xcode-select', ['-p'], { signal });
  const developerDir = stdout.trim();
  const { stdout: versionJson } = await spawn(
    'plutil',
    [
      '-convert',
      'json',
      '-o',
      '-',
      path.join(developerDir, '..', 'version.plist'),
    ],
    { signal }
  );
  const version = JSON.parse(versionJson) as {
    CFBundleShortVersionString?: string;
    ProductBuildVersion?: string;
  };
  const platform = SDK_PLATFORM_NAMES[destination];
  const sdkSettings = JSON.parse(
    fs.readFileSync(
      path.join(
        developerDir,
        'Platforms',
        `${platform}.platform`,
        'Developer',
        'SDKs',
        `${platform}.sdk`,
        'SDKSettings.json'
      ),
      'utf8'
    )
  ) as { Version?: string };

  if (
    !version.CFBundleShortVersionString ||
    !version.ProductBuildVersion ||
    !sdkSettings.Version
  ) {
    throw new Error(`Incomplete Xcode version information in ${developerDir}`);
  }

  return {
    sdkVersion: sdkSettings.Version,
    xcodeBuild: version.ProductBuildVersion,
    xcodeVersion: version.CFBundleShortVersionString,
  };
};

/**
 * Identifies the selected Xcode toolchain: recorded with packed artifacts, and
 * checked against the minimum a shipped artifact supports before it is used.
 */
export const resolveXCTestAgentToolchain = async (
  destination: XCTestAgentBuildDestination,
  signal?: AbortSignal
): Promise<XCTestAgentToolchain> => {
  try {
    return await readXCTestAgentToolchain(destination, signal);
  } catch (error) {
    signal?.throwIfAborted();
    xctestAgentLogger.debug(
      'reading the Xcode toolchain from disk failed, asking xcodebuild: %s',
      error instanceof Error ? error.message : String(error)
    );
  }

  const [versionOutput, sdkVersion] = await Promise.all([
    spawn('xcodebuild', ['-version'], { signal }).then(({ stdout }) =>
      stdout.trim()
    ),
    spawn(
      'xcodebuild',
      [
        '-version',
        '-sdk',
        destination === 'simulator' ? 'iphonesimulator' : 'iphoneos',
        'SDKVersion',
      ],
      { signal }
    ).then(({ stdout }) => stdout.trim()),
  ]);

  return {
    sdkVersion,
    xcodeBuild: /Build version\s+(\S+)/.exec(versionOutput)?.[1] ?? '',
    xcodeVersion: /Xcode\s+(\S+)/.exec(versionOutput)?.[1] ?? versionOutput,
  };
};

const getSimulatorCacheContext = async (
  buildInputsHash: string,
  signal?: AbortSignal
): Promise<SimulatorXCTestAgentCacheContext> => {
  const [xcodeVersion, simulatorSdkVersion] = await Promise.all([
    getCurrentXcodeVersion(signal),
    getCurrentSimulatorSdkVersion(signal),
  ]);

  return {
    buildInputsHash,
    hostArchitecture: process.arch,
    simulatorSdkVersion,
    xcodeVersion,
  };
};

const shouldReuseBuildArtifacts = (options: {
  buildInputsHash: string;
  derivedDataPath: string;
  destination: XCTestAgentBuildDestination;
  signing?: XCTestAgentBuildSigning;
}): boolean => {
  if (options.destination === 'simulator') {
    throw new Error(
      'Simulator build reuse must be validated with cache compatibility metadata'
    );
  }

  const manifest = readBuildManifest(options.derivedDataPath);

  if (!manifest) {
    return false;
  }

  if (
    manifest.buildInputsHash !== options.buildInputsHash ||
    manifest.destinationKind !== options.destination
  ) {
    return false;
  }

  if (
    manifest.signing?.teamId !== options.signing?.teamId ||
    manifest.signing?.signingIdentity !== options.signing?.signingIdentity ||
    manifest.signing?.provisioningProfile !==
      options.signing?.provisioningProfile
  ) {
    return false;
  }

  const buildProductsPath = getXCTestAgentBuildProductsPath(
    options.derivedDataPath
  );

  return fs.existsSync(buildProductsPath);
};

/**
 * Build settings that only slow the build down or grow its products.
 *
 * The agent is never debugged, indexed, previewed, or measured for coverage,
 * so these cut a clean build by about a third. They also keep the products
 * free of the build machine's paths: coverage mapping, debug info, and the
 * `.xctestrun` source map all embed absolute paths, which packed artifacts must
 * not carry.
 */
const XCTEST_AGENT_BUILD_FLAGS = [
  '-enableCodeCoverage',
  'NO',
  'COMPILER_INDEX_STORE_ENABLE=NO',
  'ENABLE_DEBUG_DYLIB=NO',
  'ENABLE_PREVIEWS=NO',
  'GCC_GENERATE_DEBUGGING_SYMBOLS=NO',
];

/**
 * Runs `xcodebuild build-for-testing` into `derivedDataPath` and returns the
 * generated `.xctestrun`, relative to the build products directory.
 */
export const runXCTestAgentBuild = async (options: {
  derivedDataPath: string;
  destination: XCTestAgentBuildDestination;
  signal?: AbortSignal;
  signing?: XCTestAgentBuildSigning;
}): Promise<string> => {
  assertXCTestAgentProjectExists();
  fs.mkdirSync(options.derivedDataPath, { recursive: true });

  const provisioningArgs =
    options.destination === 'device' && options.signing?.teamId
      ? ['-allowProvisioningUpdates']
      : [];

  await spawn(
    'xcodebuild',
    [
      'build-for-testing',
      '-project',
      getXCTestAgentProjectFilePath(),
      '-scheme',
      XCTEST_AGENT_SCHEME_NAME,
      '-destination',
      getXCTestAgentBuildDestination(options.destination),
      '-derivedDataPath',
      options.derivedDataPath,
      ...XCTEST_AGENT_BUILD_FLAGS,
      ...provisioningArgs,
      ...getXCTestAgentBuildSigningArgs(options.destination, options.signing),
    ],
    {
      cwd: getXCTestAgentProjectRoot(),
      signal: options.signal,
    }
  );

  const xctestrunRelativePath = getXCTestRunRelativePath(
    options.derivedDataPath
  );

  if (!xctestrunRelativePath) {
    throw new Error(
      `Missing generated .xctestrun file in ${getXCTestAgentBuildProductsPath(
        options.derivedDataPath
      )}`
    );
  }

  return xctestrunRelativePath;
};

const getXCTestRunPath = (derivedDataPath: string): string | undefined => {
  const xctestrunRelativePath = getXCTestRunRelativePath(derivedDataPath);

  if (!xctestrunRelativePath) {
    return undefined;
  }

  const buildProductsPath = getXCTestAgentBuildProductsPath(derivedDataPath);

  return path.join(buildProductsPath, xctestrunRelativePath);
};

export const buildXCTestAgent = async (
  options: BuildXCTestAgentOptions
): Promise<BuildXCTestAgentResult> => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const buildInputsHash = getProjectInputsHash();
  let derivedDataPath = getXCTestAgentDerivedDataPath(
    options.destination,
    projectRoot
  );
  let simulatorCacheContext: SimulatorXCTestAgentCacheContext | undefined;

  xctestAgentLogger.debug(
    'verifying checked-in XCTest agent project for %s',
    options.destination
  );
  xctestAgentLogger.info(
    'Using checked-in XCTest agent project for %s target',
    options.destination
  );
  assertXCTestAgentProjectExists();

  if (options.destination === 'simulator') {
    simulatorCacheContext = await getSimulatorCacheContext(
      buildInputsHash,
      options.signal
    );
    const reusableDerivedDataPath = findReusableSimulatorBuildArtifacts(
      simulatorCacheContext,
      projectRoot
    );

    if (reusableDerivedDataPath) {
      xctestAgentLogger.info(
        'Reusing cached XCTest agent build for %s target',
        options.destination
      );
      xctestAgentLogger.debug(
        'reusing cached XCTest agent build for %s',
        options.destination
      );

      return {
        destination: options.destination,
        derivedDataPath: reusableDerivedDataPath,
        reused: true,
        xctestrunPath: getXCTestRunPath(reusableDerivedDataPath),
      };
    }

    derivedDataPath = getSimulatorCacheDerivedDataPath(
      simulatorCacheContext,
      projectRoot
    );
  } else {
    const canReuseBuild = shouldReuseBuildArtifacts({
      buildInputsHash,
      derivedDataPath,
      destination: options.destination,
      signing: options.signing,
    });

    if (canReuseBuild) {
      xctestAgentLogger.info(
        'Reusing cached XCTest agent build for %s target',
        options.destination
      );
      xctestAgentLogger.debug(
        'reusing cached XCTest agent build for %s',
        options.destination
      );

      return {
        destination: options.destination,
        derivedDataPath,
        reused: true,
        xctestrunPath: getXCTestRunPath(derivedDataPath),
      };
    }
  }

  xctestAgentLogger.debug('building XCTest agent for %s', options.destination);
  xctestAgentLogger.info(
    'Building XCTest agent for %s target',
    options.destination
  );

  const xctestrunRelativePath = await runXCTestAgentBuild({
    derivedDataPath,
    destination: options.destination,
    signal: options.signal,
    signing: options.signing,
  });

  if (options.destination === 'simulator') {
    if (!simulatorCacheContext) {
      throw new Error('Missing simulator cache context for XCTest agent build');
    }

    writeSimulatorBuildManifest(derivedDataPath, {
      artifactName: XCTEST_AGENT_SIMULATOR_CACHE_ARTIFACT,
      destinationKind: 'simulator',
      schemaVersion: XCTEST_AGENT_SIMULATOR_CACHE_SCHEMA_VERSION,
      xctestrunRelativePath,
      ...simulatorCacheContext,
    });
  } else {
    writeBuildManifest(derivedDataPath, {
      buildInputsHash,
      destinationKind: options.destination,
      signing: options.signing,
    });
  }

  xctestAgentLogger.info(
    'Built XCTest agent for %s target',
    options.destination
  );

  const buildProductsPath = getXCTestAgentBuildProductsPath(derivedDataPath);

  return {
    destination: options.destination,
    derivedDataPath,
    reused: false,
    xctestrunPath: path.join(buildProductsPath, xctestrunRelativePath),
  };
};

/**
 * Fallback provider: produces artifacts on the consumer's machine with
 * `xcodebuild build-for-testing`, reusing a local build when its manifest
 * still matches.
 */
export const createBuildXCTestAgentProvider = (): XCTestAgentProvider => ({
  id: 'build',
  prepare: async (context) => {
    // The remap escape hatch belongs to the prebuilt path alone. It cannot be
    // applied to a build: `xcodebuild` takes `PRODUCT_BUNDLE_IDENTIFIER` as a
    // global override, and the agent project builds two targets whose ids must
    // stay distinct, so one override would collapse the app and the test bundle
    // onto the same id and the install would be rejected as a duplicate.
    if (context.destination === 'device' && context.signing?.bundleIdPrefix) {
      xctestAgentLogger.warn(
        'device.codeSign.bundleIdPrefix cannot be applied to a locally built agent (it would give both agent targets the same bundle id), building com.callstackincubator.HarnessXCTestAgent as-is'
      );
    }

    const result = await buildXCTestAgent({
      destination: context.destination,
      signing: context.signing,
      projectRoot: context.projectRoot,
      signal: context.signal,
    });

    return {
      // `test-without-building` resolves products inside the derived data
      // folder from the project and scheme, which is how a locally built
      // agent has always been launched.
      launch: {
        derivedDataPath: result.derivedDataPath,
        kind: 'project',
        projectFilePath: getXCTestAgentProjectFilePath(),
        scheme: XCTEST_AGENT_SCHEME_NAME,
      },
      source: 'build',
    };
  },
});
