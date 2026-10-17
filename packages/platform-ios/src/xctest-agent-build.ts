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

const getProjectInputFilePaths = (root: string): string[] => {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'build' || entry.name === '.gitignore') {
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

const getCurrentDeviceSdkVersion = async (
  signal?: AbortSignal
): Promise<string> => {
  const { stdout } = await spawn(
    'xcodebuild',
    ['-version', '-sdk', 'iphoneos', 'SDKVersion'],
    { signal }
  );
  return stdout.trim();
};

export type XCTestAgentToolchain = {
  sdkVersion: string;
  xcodeBuild: string;
  xcodeVersion: string;
};

/**
 * Identifies the toolchain that a build product was produced with, so a
 * prebuilt artifact is only reused by the Xcode it was packed with.
 */
export const resolveXCTestAgentToolchain = async (
  destination: XCTestAgentBuildDestination,
  signal?: AbortSignal
): Promise<XCTestAgentToolchain> => {
  const [versionOutput, sdkVersion] = await Promise.all([
    spawn('xcodebuild', ['-version'], { signal }).then(({ stdout }) =>
      stdout.trim()
    ),
    destination === 'simulator'
      ? getCurrentSimulatorSdkVersion(signal)
      : getCurrentDeviceSdkVersion(signal),
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

  fs.mkdirSync(derivedDataPath, { recursive: true });

  xctestAgentLogger.debug('building XCTest agent for %s', options.destination);
  xctestAgentLogger.info(
    'Building XCTest agent for %s target',
    options.destination
  );

  const signingArgs = getXCTestAgentBuildSigningArgs(
    options.destination,
    options.signing
  );
  const provisioningArgs: string[] = [];

  if (options.destination === 'device' && options.signing?.teamId) {
    provisioningArgs.push('-allowProvisioningUpdates');
  }

  const buildArgs = [
    'build-for-testing',
    '-project',
    getXCTestAgentProjectFilePath(),
    '-scheme',
    XCTEST_AGENT_SCHEME_NAME,
    '-destination',
    getXCTestAgentBuildDestination(options.destination),
    '-derivedDataPath',
    derivedDataPath,
    ...provisioningArgs,
    ...signingArgs,
  ];

  await spawn('xcodebuild', buildArgs, {
    cwd: getXCTestAgentProjectRoot(),
    signal: options.signal,
  });

  const xctestrunRelativePath = getXCTestRunRelativePath(derivedDataPath);

  if (!xctestrunRelativePath) {
    throw new Error(
      `Missing generated .xctestrun file in ${getXCTestAgentBuildProductsPath(
        derivedDataPath
      )}`
    );
  }

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
