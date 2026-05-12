import {
  createHarnessArtifactDirectory,
  getHarnessCacheRootPath,
  getAvailablePort,
  logger,
  spawn,
  type Subprocess,
} from '@react-native-harness/tools';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { PassThrough, pipeline } from 'node:stream';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createXCTestAgentClient,
  type XCTestAgentPermissionsConfiguration,
} from './xctest-agent-client.js';
import type { XCTestAgentTransport } from './xctest-agent-transport.js';
import { createDeviceXCTestAgentTransport } from './xctest-agent-transport-device.js';
import { createSimulatorXCTestAgentTransport } from './xctest-agent-transport-simulator.js';

const xctestAgentLogger = logger.child('ios-xctest-agent');

const XCTEST_AGENT_PROJECT_NAME = 'HarnessXCTestAgent';
const XCTEST_AGENT_SCHEME_NAME = 'HarnessXCTestAgent';
const XCTEST_AGENT_PORT_ENV = 'HARNESS_XCTEST_AGENT_PORT';
const XCTEST_AGENT_TARGET_BUNDLE_ID_ENV =
  'HARNESS_XCTEST_AGENT_TARGET_BUNDLE_ID';
const XCTEST_AGENT_STARTUP_TIMEOUT_MS = 120_000;
const XCTEST_AGENT_SHUTDOWN_TIMEOUT_MS = 5_000;
const XCTEST_AGENT_STARTUP_POLL_INTERVAL_MS = 250;
const HARNESS_DIRNAME = '.harness';
const XCTEST_AGENT_BUILD_DIRNAME = 'xctest-agent';
const XCTEST_AGENT_SIMULATOR_CACHE_ARTIFACT = 'xctest-agent-simulator';
const XCTEST_AGENT_SIMULATOR_CACHE_SCHEMA_VERSION = 1;
const pipelineAsync = promisify(pipeline);

export type XCTestAgentBuildDestination = 'simulator' | 'device';

export type XCTestAgentBuildSigning = {
  teamId?: string;
  signingIdentity?: string;
  provisioningProfile?: string;
};

export type BuildXCTestAgentOptions = {
  destination: XCTestAgentBuildDestination;
  signing?: XCTestAgentBuildSigning;
  projectRoot?: string;
};

export type BuildXCTestAgentResult = {
  destination: XCTestAgentBuildDestination;
  derivedDataPath: string;
  reused: boolean;
  xctestrunPath?: string;
};

type XCTestAgentTarget =
  | {
      kind: 'simulator';
      id: string;
    }
  | {
      kind: 'device';
      id: string;
      codeSign?: XCTestAgentBuildSigning;
    };

export type XCTestAgentCapability = {
  getLaunchEnvironment?: () => Record<string, string>;
  updateConfiguration?: (
    configuration: XCTestAgentRuntimeConfiguration
  ) => XCTestAgentRuntimeConfiguration;
};

export type XCTestAgentRuntimeConfiguration = {
  permissions: XCTestAgentPermissionsConfiguration;
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

export type XCTestAgentController = {
  prepare: () => Promise<void>;
  ensureStarted: () => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
};

const getXCTestAgentProjectRoot = (): string => {
  return fileURLToPath(new URL('../xctest-agent', import.meta.url));
};

const getXCTestAgentProjectFilePath = (): string => {
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

const getXCTestAgentDerivedDataPath = (
  destination: XCTestAgentBuildDestination,
  projectRoot = process.cwd()
): string => {
  return path.join(getXCTestAgentBuildRoot(projectRoot), destination);
};

const getXCTestAgentBuildManifestPath = (derivedDataPath: string): string =>
  path.join(derivedDataPath, 'build-manifest.json');

const getXCTestAgentCacheManifestPath = (derivedDataPath: string): string =>
  path.join(derivedDataPath, 'cache.json');

const getXCTestAgentBuildDestination = (
  destination: XCTestAgentBuildDestination
): string => {
  if (destination === 'simulator') {
    return 'generic/platform=iOS Simulator';
  }

  return 'generic/platform=iOS';
};

const getXCTestAgentRunDestination = (target: XCTestAgentTarget): string => {
  if (target.kind === 'simulator') {
    return `platform=iOS Simulator,id=${target.id}`;
  }

  return `platform=iOS,id=${target.id}`;
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

const getXCTestAgentBuildProductsPath = (derivedDataPath: string): string =>
  path.join(derivedDataPath, 'Build', 'Products');

const getXCTestAgentSourceFilePath = (): string => {
  return fileURLToPath(import.meta.url);
};

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

const getProjectInputsHash = (): string => {
  const projectRoot = getXCTestAgentProjectRoot();
  const hash = createHash('sha256');

  for (const filePath of getProjectInputFilePaths(projectRoot)) {
    hash.update(path.relative(projectRoot, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  const sourceFilePath = getXCTestAgentSourceFilePath();
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

const getCurrentXcodeVersion = async (): Promise<string> => {
  const { stdout } = await spawn('xcodebuild', ['-version']);
  return stdout.trim();
};

const getCurrentSimulatorSdkVersion = async (): Promise<string> => {
  const { stdout } = await spawn('xcodebuild', [
    '-version',
    '-sdk',
    'iphonesimulator',
    'SDKVersion',
  ]);
  return stdout.trim();
};

const getSimulatorCacheContext = async (
  buildInputsHash: string
): Promise<SimulatorXCTestAgentCacheContext> => {
  const [xcodeVersion, simulatorSdkVersion] = await Promise.all([
    getCurrentXcodeVersion(),
    getCurrentSimulatorSdkVersion(),
  ]);

  return {
    buildInputsHash,
    hostArchitecture: process.arch,
    simulatorSdkVersion,
    xcodeVersion,
  };
};

const shouldReuseBuildArtifacts = (
  options: {
    buildInputsHash: string;
    derivedDataPath: string;
    destination: XCTestAgentBuildDestination;
    signing?: XCTestAgentBuildSigning;
  }
): boolean => {
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
    manifest.signing?.provisioningProfile !== options.signing?.provisioningProfile
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
    simulatorCacheContext = await getSimulatorCacheContext(buildInputsHash);
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

  await spawn('xcodebuild', buildArgs);

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

const getDefaultRuntimeConfiguration = (): XCTestAgentRuntimeConfiguration => {
  return {
    permissions: {
      autoAcceptPermissions: false,
    },
  };
};

const getRuntimeConfiguration = (
  capabilities: XCTestAgentCapability[]
): XCTestAgentRuntimeConfiguration => {
  return capabilities.reduce((configuration, capability) => {
    return capability.updateConfiguration?.(configuration) ?? configuration;
  }, getDefaultRuntimeConfiguration());
};

const delay = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const waitForAgentReady = async (options: {
  client: ReturnType<typeof createXCTestAgentClient>;
  startupTimeoutMs: number;
}) => {
  const deadline = Date.now() + options.startupTimeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      await options.client.health();
      return;
    } catch (error) {
      lastError = error;
      await delay(XCTEST_AGENT_STARTUP_POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Timed out waiting for XCTest agent readiness: ${getErrorMessage(
      lastError
    )}`
  );
};

const waitForShutdown = async (options: {
  processTask: Promise<void> | null;
  shutdownTimeoutMs: number;
}): Promise<boolean> => {
  if (!options.processTask) {
    return true;
  }

  const timedOut = Symbol('timedOut');
  const result = await Promise.race([
    options.processTask.then(() => undefined),
    delay(options.shutdownTimeoutMs).then(() => timedOut),
  ]);

  return result !== timedOut;
};

const waitForChildProcessExit = async (subprocess: Subprocess) => {
  const childProcess = await subprocess.nodeChildProcess;

  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      childProcess.off('close', finish);
      childProcess.off('error', finish);
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    childProcess.once('close', finish);
    childProcess.once('error', finish);
  });
};

const stopProcess = async (options: {
  process: Subprocess | null;
  processTask: Promise<void> | null;
  shutdownTimeoutMs: number;
  targetKind: XCTestAgentTarget['kind'];
}) => {
  if (!options.process) {
    return;
  }

  let childProcess: Awaited<Subprocess['nodeChildProcess']>;

  try {
    childProcess = await options.process.nodeChildProcess;
  } catch {
    return;
  }

  childProcess.kill('SIGTERM');

  if (
    await waitForShutdown({
      processTask: options.processTask,
      shutdownTimeoutMs: options.shutdownTimeoutMs,
    })
  ) {
    return;
  }

  xctestAgentLogger.warn(
    'XCTest agent session for %s target did not stop after %dms; forcing shutdown',
    options.targetKind,
    options.shutdownTimeoutMs
  );
  childProcess.kill('SIGKILL');

  await waitForShutdown({
    processTask: options.processTask,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
  });
};

const toTestRunnerEnv = (env: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`TEST_RUNNER_${key}`, value])
  );

const getErrorMessage = (error: unknown): string => {
  if (!error) {
    return 'unknown error';
  }

  return error instanceof Error ? error.message : String(error);
};

const attachProcessOutputLog = async (options: {
  command: string;
  logFilePath: string;
  process: Subprocess;
}) => {
  fs.mkdirSync(path.dirname(options.logFilePath), { recursive: true });
  fs.writeFileSync(
    options.logFilePath,
    [
      `timestamp=${new Date().toISOString()}`,
      `command=${options.command}`,
      '',
    ].join('\n'),
    'utf8'
  );
  const output = fs.createWriteStream(options.logFilePath, { flags: 'a' });

  const childProcess = await options.process.nodeChildProcess;
  const mergedOutput = new PassThrough();
  const forwardStream = async (
    stream: NodeJS.ReadableStream | null | undefined,
    label: 'stdout' | 'stderr'
  ) => {
    if (!stream) {
      return;
    }

    for await (const chunk of stream) {
      mergedOutput.write(`[${label}] `);
      mergedOutput.write(chunk);
      if (
        Buffer.isBuffer(chunk)
          ? !chunk.includes(0x0a)
          : !String(chunk).endsWith('\n')
      ) {
        mergedOutput.write('\n');
      }
    }
  };

  const pipeTask = pipelineAsync(mergedOutput, output);
  const forwardTask = Promise.all([
    forwardStream(childProcess.stdout, 'stdout'),
    forwardStream(childProcess.stderr, 'stderr'),
  ]).finally(() => {
    mergedOutput.end();
  });

  void Promise.allSettled([pipeTask, forwardTask]);
};

export const createXCTestAgentController = (options: {
  appBundleId?: string;
  target: XCTestAgentTarget;
  capabilities?: XCTestAgentCapability[];
  port?: number;
  shutdownTimeoutMs?: number;
  startupTimeoutMs?: number;
}): XCTestAgentController => {
  const { target } = options;
  const capabilities = options.capabilities ?? [];
  const startupTimeoutMs =
    options.startupTimeoutMs ?? XCTEST_AGENT_STARTUP_TIMEOUT_MS;
  const shutdownTimeoutMs =
    options.shutdownTimeoutMs ?? XCTEST_AGENT_SHUTDOWN_TIMEOUT_MS;
  const logArtifacts = createHarnessArtifactDirectory({
    artifactType: 'logs',
    bundleId: options.appBundleId,
    platformId: 'ios',
    runnerName: `xctest-agent-${target.kind}`,
  });
  const xcodebuildLogPath = path.join(
    logArtifacts.directoryPath,
    'xcodebuild.log'
  );
  let preparedDerivedDataPath = getXCTestAgentDerivedDataPath(target.kind);
  let prepared = false;
  let agentProcess: Subprocess | null = null;
  let agentClient: ReturnType<typeof createXCTestAgentClient> | null = null;
  let processTask: Promise<void> | null = null;

  const getLaunchEnvironment = (): Record<string, string> => {
    return Object.assign(
      {},
      options.appBundleId
        ? {
            [XCTEST_AGENT_TARGET_BUNDLE_ID_ENV]: options.appBundleId,
          }
        : {},
      ...capabilities.map(
        (capability) => capability.getLaunchEnvironment?.() ?? {}
      )
    );
  };

  const createTransport = (port: number): XCTestAgentTransport => {
    if (target.kind === 'simulator') {
      return createSimulatorXCTestAgentTransport({ port });
    }

    return createDeviceXCTestAgentTransport({
      deviceId: target.id,
      port,
    });
  };

  const prepare = async () => {
    if (prepared) {
      return;
    }

    let signing: XCTestAgentBuildSigning | undefined;

    if (target.kind === 'device') {
      signing = target.codeSign;
    }

    const buildResult = await buildXCTestAgent({
      destination: target.kind,
      signing,
    });

    preparedDerivedDataPath = buildResult.derivedDataPath;
    prepared = true;
  };

  const ensureStarted = async () => {
    await prepare();

    if (agentProcess && agentClient) {
      return;
    }

    const port = options.port ?? (await getAvailablePort());
    const runtimeConfiguration = getRuntimeConfiguration(capabilities);

    xctestAgentLogger.debug('starting XCTest agent for %s', target.kind);
    xctestAgentLogger.info(
      'Starting XCTest agent session for %s target',
      target.kind
    );
    xctestAgentLogger.debug('Using XCTest agent port %d', port);
    const xcodebuildArgs = [
      'test-without-building',
      '-project',
      getXCTestAgentProjectFilePath(),
      '-scheme',
      XCTEST_AGENT_SCHEME_NAME,
      '-destination',
      getXCTestAgentRunDestination(target),
      '-parallel-testing-enabled',
      'NO',
      '-maximum-parallel-testing-workers',
      '1',
      '-derivedDataPath',
      preparedDerivedDataPath,
    ];
    agentProcess = spawn('xcodebuild', xcodebuildArgs, {
      cwd: getXCTestAgentProjectRoot(),
      env: {
        ...process.env,
        ...toTestRunnerEnv({
          [XCTEST_AGENT_PORT_ENV]: String(port),
          ...getLaunchEnvironment(),
        }),
      },
    });
    void attachProcessOutputLog({
      command: ['xcodebuild', ...xcodebuildArgs].join(' '),
      logFilePath: xcodebuildLogPath,
      process: agentProcess,
    });
    xctestAgentLogger.info(
      'Saving XCTest agent xcodebuild logs to %s',
      xcodebuildLogPath
    );

    const currentProcess = agentProcess;
    if (typeof currentProcess.catch === 'function') {
      void currentProcess.catch((error) => {
        xctestAgentLogger.debug('XCTest agent process stopped', error);
      });
    }
    const transport = createTransport(port);
    const client = createXCTestAgentClient(transport);
    agentClient = client;

    processTask = waitForChildProcessExit(currentProcess).finally(() => {
      if (agentProcess === currentProcess) {
        agentProcess = null;
        agentClient = null;
        processTask = null;
      }
    });

    try {
      await waitForAgentReady({
        client,
        startupTimeoutMs,
      });
      await client.configurePermissions(runtimeConfiguration.permissions);
    } catch (error) {
      xctestAgentLogger.warn(
        'XCTest agent startup failed for %s: %s (logs: %s)',
        target.kind,
        getErrorMessage(error),
        xcodebuildLogPath
      );
      await transport.dispose();
      agentClient = null;
      await stopProcess({
        process: currentProcess,
        processTask,
        shutdownTimeoutMs,
        targetKind: target.kind,
      });
      throw error;
    }
  };

  const stop = async () => {
    const currentProcess = agentProcess;
    const currentClient = agentClient;
    const currentProcessTask = processTask;
    agentProcess = null;
    agentClient = null;
    processTask = null;

    xctestAgentLogger.info(
      'Stopping XCTest agent session for %s target',
      target.kind
    );

    await currentClient?.dispose();
    await stopProcess({
      process: currentProcess,
      processTask: currentProcessTask,
      shutdownTimeoutMs,
      targetKind: target.kind,
    });
  };

  return {
    prepare,
    ensureStarted,
    stop,
    dispose: async () => {
      await stop();
    },
  };
};
