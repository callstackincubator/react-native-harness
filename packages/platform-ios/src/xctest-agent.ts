import {
  createHarnessArtifactDirectory,
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
import type { ApplePhysicalDeviceCodeSign } from './config.js';
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
const pipelineAsync = promisify(pipeline);

type XCTestAgentTarget =
  | {
    kind: 'simulator';
    id: string;
  }
  | {
    kind: 'device';
    id: string;
    codeSign: ApplePhysicalDeviceCodeSign;
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
  destinationKind: XCTestAgentTarget['kind'];
  codeSign?: ApplePhysicalDeviceCodeSign;
};

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

const getXCTestAgentBuildRoot = (): string => {
  return path.join(process.cwd(), HARNESS_DIRNAME, XCTEST_AGENT_BUILD_DIRNAME);
};

const getXCTestAgentDerivedDataPath = (target: XCTestAgentTarget): string => {
  return path.join(getXCTestAgentBuildRoot(), target.kind);
};

const getXCTestAgentBuildManifestPath = (target: XCTestAgentTarget): string => {
  return path.join(
    getXCTestAgentDerivedDataPath(target),
    'build-manifest.json'
  );
};

const getXCTestAgentBuildDestination = (target: XCTestAgentTarget): string => {
  return target.kind === 'simulator'
    ? `platform=iOS Simulator,id=${target.id}`
    : `generic/platform=iOS`;
};

const getXCTestAgentRunDestination = (target: XCTestAgentTarget): string => {
  return target.kind === 'simulator'
    ? `platform=iOS Simulator,id=${target.id}`
    : `platform=iOS,id=${target.id}`;
};

const getXCTestAgentBuildSigningArgs = (
  target: XCTestAgentTarget
): string[] => {
  if (target.kind === 'simulator') {
    return [
      'CODE_SIGNING_ALLOWED=NO',
      'CODE_SIGNING_REQUIRED=NO',
      'CODE_SIGN_IDENTITY=',
      'DEVELOPMENT_TEAM=',
    ];
  }

  const { teamId, signingIdentity, provisioningProfile } = target.codeSign;
  const args = [
    'CODE_SIGN_STYLE=Automatic',
    `DEVELOPMENT_TEAM=${teamId}`,
    `CODE_SIGN_IDENTITY=${signingIdentity ?? 'Apple Development'}`,
  ];

  if (provisioningProfile) {
    args.push(`PROVISIONING_PROFILE_SPECIFIER=${provisioningProfile}`);
  }

  return args;
};

const getXCTestAgentBuildProductsPath = (target: XCTestAgentTarget): string => {
  return path.join(getXCTestAgentDerivedDataPath(target), 'Build', 'Products');
};

const readBuildManifest = (
  target: XCTestAgentTarget
): XCTestAgentBuildManifest | null => {
  const manifestPath = getXCTestAgentBuildManifestPath(target);

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  ) as XCTestAgentBuildManifest;
};

const writeBuildManifest = (
  target: XCTestAgentTarget,
  manifest: XCTestAgentBuildManifest
) => {
  fs.mkdirSync(getXCTestAgentDerivedDataPath(target), { recursive: true });
  fs.writeFileSync(
    getXCTestAgentBuildManifestPath(target),
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

  return hash.digest('hex');
};

const shouldReuseBuildArtifacts = (
  target: XCTestAgentTarget,
  buildInputsHash: string
): boolean => {
  const manifest = readBuildManifest(target);

  if (!manifest) {
    return false;
  }

  if (
    manifest.buildInputsHash !== buildInputsHash ||
    manifest.destinationKind !== target.kind
  ) {
    return false;
  }

  if (target.kind === 'device') {
    if (
      manifest.codeSign?.teamId !== target.codeSign.teamId ||
      manifest.codeSign?.signingIdentity !== target.codeSign.signingIdentity ||
      manifest.codeSign?.provisioningProfile !==
      target.codeSign.provisioningProfile
    ) {
      return false;
    }
  }

  return fs.existsSync(getXCTestAgentBuildProductsPath(target));
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
      if (Buffer.isBuffer(chunk) ? !chunk.includes(0x0a) : !String(chunk).endsWith('\n')) {
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
  const xcodebuildLogPath = path.join(logArtifacts.directoryPath, 'xcodebuild.log');
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

    const buildInputsHash = getProjectInputsHash();

    xctestAgentLogger.debug(
      'verifying checked-in XCTest agent project for %s',
      target.kind
    );
    xctestAgentLogger.info(
      'Using checked-in XCTest agent project for %s target',
      target.kind
    );
    assertXCTestAgentProjectExists();

    if (shouldReuseBuildArtifacts(target, buildInputsHash)) {
      prepared = true;
      xctestAgentLogger.info(
        'Reusing cached XCTest agent build for %s target',
        target.kind
      );
      xctestAgentLogger.debug(
        'reusing cached XCTest agent build for %s',
        target.kind
      );
      return;
    }

    fs.mkdirSync(getXCTestAgentBuildRoot(), { recursive: true });

    xctestAgentLogger.debug('building XCTest agent for %s', target.kind);
    xctestAgentLogger.info('Building XCTest agent for %s target', target.kind);
    await spawn('xcodebuild', [
      'build-for-testing',
      '-project',
      getXCTestAgentProjectFilePath(),
      '-scheme',
      XCTEST_AGENT_SCHEME_NAME,
      '-destination',
      getXCTestAgentBuildDestination(target),
      '-derivedDataPath',
      getXCTestAgentDerivedDataPath(target),
      ...(target.kind === 'device' ? ['-allowProvisioningUpdates'] : []),
      ...getXCTestAgentBuildSigningArgs(target),
    ]);

    writeBuildManifest(target, {
      buildInputsHash,
      destinationKind: target.kind,
      codeSign: target.kind === 'device' ? target.codeSign : undefined,
    });
    xctestAgentLogger.info('Built XCTest agent for %s target', target.kind);
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
      getXCTestAgentDerivedDataPath(target),
    ];
    agentProcess = spawn(
      'xcodebuild',
      xcodebuildArgs,
      {
        cwd: getXCTestAgentProjectRoot(),
        env: {
          ...process.env,
          ...toTestRunnerEnv({
            [XCTEST_AGENT_PORT_ENV]: String(port),
            ...getLaunchEnvironment(),
          }),
        },
      }
    );
    void attachProcessOutputLog({
      command: ['xcodebuild', ...xcodebuildArgs].join(' '),
      logFilePath: xcodebuildLogPath,
      process: agentProcess,
    });
    xctestAgentLogger.info('Saving XCTest agent xcodebuild logs to %s', xcodebuildLogPath);

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
