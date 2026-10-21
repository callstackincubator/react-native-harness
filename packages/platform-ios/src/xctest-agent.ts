import {
  createHarnessArtifactDirectory,
  getAvailablePort,
  delay as cancellableDelay,
  logger,
  spawnOwnedProcess,
  waitForAbort,
  type OwnedProcess,
  type Subprocess,
} from '@react-native-harness/tools';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { PassThrough, pipeline } from 'node:stream';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  createXCTestAgentClient,
  type XCTestAgentPermissionsConfiguration,
} from './xctest-agent-client.js';
import type { XCTestAgentTransport } from './xctest-agent-transport.js';
import { createDeviceXCTestAgentTransport } from './xctest-agent-transport-device.js';
import { createSimulatorXCTestAgentTransport } from './xctest-agent-transport-simulator.js';
import {
  resolveXCTestAgentArtifacts,
  type XCTestAgentBuildSigning,
  type XCTestAgentLaunchInput,
  type XCTestAgentProvider,
} from './xctest-agent-artifacts.js';
import {
  createBuildXCTestAgentProvider,
  getXCTestAgentDerivedDataPath,
  getXCTestAgentProjectRoot,
} from './xctest-agent-build.js';
import { createPrebuiltXCTestAgentProvider } from './xctest-agent-prebuilt.js';
import { createResignedDeviceXCTestAgentProvider } from './xctest-agent-resign.js';
import { getDefaultXCTestAgentTickIntervalMs } from './startup-strategy.js';

const pipelineAsync = promisify(pipeline);

export type {
  BuildXCTestAgentOptions,
  BuildXCTestAgentResult,
} from './xctest-agent-build.js';
export type {
  XCTestAgentArtifactSource,
  XCTestAgentBuildDestination,
  XCTestAgentBuildSigning,
} from './xctest-agent-artifacts.js';
export { buildXCTestAgent } from './xctest-agent-build.js';

const xctestAgentLogger = logger.child('ios-xctest-agent');

const XCTEST_AGENT_PORT_ENV = 'HARNESS_XCTEST_AGENT_PORT';
const XCTEST_AGENT_TICK_INTERVAL_MS_ENV =
  'HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS';
const XCTEST_AGENT_TARGET_BUNDLE_ID_ENV =
  'HARNESS_XCTEST_AGENT_TARGET_BUNDLE_ID';
const XCTEST_AGENT_XCTESTRUN_FILE_ENV = 'HARNESS_IOS_XCTESTRUN_FILE';
const XCTEST_AGENT_DERIVED_DATA_PATH_ENV =
  'HARNESS_IOS_XCTEST_DERIVED_DATA_PATH';
const XCTEST_AGENT_STARTUP_TIMEOUT_MS = 120_000;
const XCTEST_AGENT_STARTUP_POLL_INTERVAL_MS = 250;

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

export type XCTestAgentController = {
  prepare: (signal?: AbortSignal) => Promise<void>;
  ensureStarted: (signal?: AbortSignal) => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
};

const getEnvironmentPath = (name: string): string | null => {
  const value = process.env[name]?.trim();

  if (!value) {
    return null;
  }

  return value;
};

/**
 * Provider for artifacts prepared outside of Harness, pointed at with
 * `HARNESS_IOS_XCTESTRUN_FILE`. This lets CI or a local script hand Harness a
 * ready `.xctestrun` and skip artifact preparation entirely.
 */
const createExternalXCTestAgentProvider = (): XCTestAgentProvider => ({
  id: 'external',
  prepare: (context) => {
    const xctestrunFilePath = getEnvironmentPath(
      XCTEST_AGENT_XCTESTRUN_FILE_ENV
    );

    if (!xctestrunFilePath) {
      return null;
    }

    if (!fs.existsSync(xctestrunFilePath)) {
      throw new Error(
        `Missing external XCTest run file at ${xctestrunFilePath}. Check ${XCTEST_AGENT_XCTESTRUN_FILE_ENV}.`
      );
    }

    return {
      launch: {
        derivedDataPath:
          getEnvironmentPath(XCTEST_AGENT_DERIVED_DATA_PATH_ENV) ??
          getXCTestAgentDerivedDataPath(context.destination, context.projectRoot),
        kind: 'xctestrun',
        xctestrunPath: xctestrunFilePath,
      },
      source: 'external',
    };
  },
});

/**
 * Artifact sources in the order they are trusted: an explicitly supplied
 * run file, then artifacts shipped with the package, then a local build.
 *
 * Simulator and device artifacts need separate providers. A simulator build is
 * runnable as shipped; a device build is shipped unsigned and has to acquire
 * the consumer's signature first.
 */
export const createDefaultXCTestAgentProviders = (): XCTestAgentProvider[] => [
  createExternalXCTestAgentProvider(),
  createPrebuiltXCTestAgentProvider(),
  createResignedDeviceXCTestAgentProvider(),
  createBuildXCTestAgentProvider(),
];

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

const delay = async (ms: number, signal?: AbortSignal) => {
  if (!signal) {
    await cancellableDelay(ms).promise;
    return;
  }

  signal.throwIfAborted();
  const abortWait = waitForAbort(signal);
  const timeout = cancellableDelay(ms);
  try {
    await Promise.race([timeout.promise, abortWait.promise]);
  } finally {
    abortWait.cancel();
    timeout.cancel();
  }
};

const waitForAbortable = async <T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> => {
  if (!signal) {
    return await promise;
  }

  signal.throwIfAborted();
  const abortWait = waitForAbort(signal);
  try {
    return await Promise.race([promise, abortWait.promise]);
  } finally {
    abortWait.cancel();
  }
};

class XCTestAgentStartupExitError extends Error {}

type XCTestAgentStartupExitWatch = {
  exited: Promise<string>;
  getExitDescription: () => string | null;
  cancel: () => void;
};

const describeChildProcessExit = (
  code: number | null,
  signal: NodeJS.Signals | null
): string =>
  signal
    ? `xcodebuild was terminated by signal ${signal}`
    : `xcodebuild exited with code ${code}`;

// Watches the xcodebuild child for the duration of the startup wait. Unlike
// waitForChildProcessExit, it also records an exit that happened before the
// listeners were attached, so startup can fail fast instead of polling a port
// that will never open.
const watchChildProcessStartupExit = (
  subprocess: Subprocess
): XCTestAgentStartupExitWatch => {
  let exitDescription: string | null = null;
  let cancelled = false;
  let detach = () => undefined;

  const exited = new Promise<string>((resolve) => {
    const finish = (description: string) => {
      exitDescription = description;
      detach();
      resolve(description);
    };

    const attach = (childProcess: ChildProcess) => {
      if (cancelled) {
        return;
      }

      const { exitCode, signalCode } = childProcess;
      if (exitCode !== null || signalCode !== null) {
        finish(describeChildProcessExit(exitCode, signalCode));
        return;
      }

      const handleClose = (
        code: number | null,
        signal: NodeJS.Signals | null
      ) => finish(describeChildProcessExit(code, signal));
      const handleError = (error: Error) =>
        finish(`xcodebuild failed to start: ${error.message}`);

      detach = () => {
        childProcess.off('close', handleClose);
        childProcess.off('error', handleError);
      };
      childProcess.once('close', handleClose);
      childProcess.once('error', handleError);
    };

    void subprocess.nodeChildProcess.then(attach, () => undefined);
  });

  return {
    exited,
    getExitDescription: () => exitDescription,
    cancel: () => {
      cancelled = true;
      detach();
    },
  };
};

const createStartupExitError = (exitDescription: string) =>
  new XCTestAgentStartupExitError(
    `XCTest agent exited before becoming ready: ${exitDescription}`
  );

const waitForAgentReady = async (options: {
  client: ReturnType<typeof createXCTestAgentClient>;
  startupTimeoutMs: number;
  signal?: AbortSignal;
  processExit?: XCTestAgentStartupExitWatch;
}) => {
  const deadline = Date.now() + options.startupTimeoutMs;
  const processExit = options.processExit;
  let lastError: unknown = null;

  const throwIfProcessExited = () => {
    const exitDescription = processExit?.getExitDescription();
    if (exitDescription) {
      throw createStartupExitError(exitDescription);
    }
  };

  // Lets a pending health check or poll delay end as soon as xcodebuild exits.
  const raceWithProcessExit = <T>(promise: Promise<T>): Promise<T> => {
    if (!processExit) {
      return promise;
    }

    return Promise.race([
      promise,
      processExit.exited.then((exitDescription) => {
        throw createStartupExitError(exitDescription);
      }),
    ]);
  };

  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    throwIfProcessExited();
    try {
      await raceWithProcessExit(
        waitForAbortable(options.client.health(), options.signal)
      );
      options.signal?.throwIfAborted();
      return;
    } catch (error) {
      if (error instanceof XCTestAgentStartupExitError) {
        throw error;
      }

      lastError = error;
      await raceWithProcessExit(
        delay(XCTEST_AGENT_STARTUP_POLL_INTERVAL_MS, options.signal)
      );
    }
  }

  throw new Error(
    `Timed out waiting for XCTest agent readiness: ${getErrorMessage(
      lastError
    )}`
  );
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
  process: OwnedProcess | null;
}) => {
  if (!options.process) {
    return;
  }

  await options.process.dispose();
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

const getXCTestAgentRunDestination = (target: XCTestAgentTarget): string => {
  if (target.kind === 'simulator') {
    return `platform=iOS Simulator,id=${target.id}`;
  }

  return `platform=iOS,id=${target.id}`;
};

const getXCTestAgentLaunchArgs = (
  target: XCTestAgentTarget,
  launch: XCTestAgentLaunchInput
): string[] => {
  const runInputArgs =
    launch.kind === 'xctestrun'
      ? ['-xctestrun', launch.xctestrunPath]
      : ['-project', launch.projectFilePath, '-scheme', launch.scheme];

  return [
    'test-without-building',
    ...runInputArgs,
    '-destination',
    getXCTestAgentRunDestination(target),
    '-parallel-testing-enabled',
    'NO',
    '-maximum-parallel-testing-workers',
    '1',
    '-derivedDataPath',
    launch.derivedDataPath,
  ];
};

export const createXCTestAgentController = (options: {
  appBundleId?: string;
  target: XCTestAgentTarget;
  capabilities?: XCTestAgentCapability[];
  port?: number;
  startupTimeoutMs?: number;
  /** Maximum time for the XCTest client to close gracefully. */
  shutdownTimeoutMs?: number;
  /** Artifact providers, consulted in order. Defaults to external then build. */
  providers?: XCTestAgentProvider[];
  projectRoot?: string;
}): XCTestAgentController => {
  const { target } = options;
  const capabilities = options.capabilities ?? [];
  const providers = options.providers ?? createDefaultXCTestAgentProviders();
  const startupTimeoutMs =
    options.startupTimeoutMs ?? XCTEST_AGENT_STARTUP_TIMEOUT_MS;
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
  let preparedLaunchInput: XCTestAgentLaunchInput | null = null;
  let prepared = false;
  let agentProcess: OwnedProcess | null = null;
  let agentClient: ReturnType<typeof createXCTestAgentClient> | null = null;

  const getLaunchEnvironment = (): Record<string, string> => {
    const defaultTickIntervalMs = getDefaultXCTestAgentTickIntervalMs();
    const tickIntervalMs =
      getEnvironmentPath(XCTEST_AGENT_TICK_INTERVAL_MS_ENV) ??
      (defaultTickIntervalMs === undefined
        ? null
        : String(defaultTickIntervalMs));

    return Object.assign(
      {},
      options.appBundleId
        ? {
            [XCTEST_AGENT_TARGET_BUNDLE_ID_ENV]: options.appBundleId,
          }
        : {},
      tickIntervalMs
        ? {
            [XCTEST_AGENT_TICK_INTERVAL_MS_ENV]: tickIntervalMs,
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

  const prepare = async (signal?: AbortSignal) => {
    if (prepared) {
      return;
    }

    const signing = target.kind === 'device' ? target.codeSign : undefined;
    const artifacts = await resolveXCTestAgentArtifacts(providers, {
      deviceId: target.kind === 'device' ? target.id : undefined,
      destination: target.kind,
      projectRoot: options.projectRoot ?? process.cwd(),
      signing,
      signal,
    });

    preparedLaunchInput = artifacts.launch;
    prepared = true;

    xctestAgentLogger.info(
      'Prepared XCTest agent artifacts for %s target (%s)',
      target.kind,
      artifacts.source
    );
  };

  const ensureStarted = async (signal?: AbortSignal) => {
    await prepare(signal);

    if (agentProcess && agentClient) {
      return;
    }

    const launch = preparedLaunchInput;

    if (!launch) {
      throw new Error(
        'XCTest agent artifacts are missing after preparation. This is a Harness bug.'
      );
    }

    const port = options.port ?? (await getAvailablePort());
    const runtimeConfiguration = getRuntimeConfiguration(capabilities);

    xctestAgentLogger.debug('starting XCTest agent for %s', target.kind);
    xctestAgentLogger.info(
      'Starting XCTest agent session for %s target',
      target.kind
    );
    xctestAgentLogger.debug('Using XCTest agent port %d', port);

    const xcodebuildArgs = getXCTestAgentLaunchArgs(target, launch);
    agentProcess = spawnOwnedProcess('xcodebuild', xcodebuildArgs, {
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
      process: agentProcess.subprocess,
    });
    xctestAgentLogger.info(
      'Saving XCTest agent xcodebuild logs to %s',
      xcodebuildLogPath
    );

    const currentProcess = agentProcess;
    if (typeof currentProcess.subprocess.catch === 'function') {
      void currentProcess.subprocess.catch((error) => {
        xctestAgentLogger.debug('XCTest agent process stopped', error);
      });
    }
    const transport = createTransport(port);
    const client = createXCTestAgentClient(transport);
    agentClient = client;

    void waitForChildProcessExit(currentProcess.subprocess).finally(() => {
      if (agentProcess === currentProcess) {
        agentProcess = null;
        agentClient = null;
      }
    });

    const processExit = watchChildProcessStartupExit(currentProcess.subprocess);

    try {
      await waitForAgentReady({
        client,
        startupTimeoutMs,
        signal,
        processExit,
      });
      await client.configurePermissions(runtimeConfiguration.permissions);
    } catch (error) {
      xctestAgentLogger.warn(
        'XCTest agent startup failed for %s: %s (logs: %s)',
        target.kind,
        getErrorMessage(error),
        xcodebuildLogPath
      );
      await client.dispose();
      agentClient = null;
      await stopProcess({ process: currentProcess });
      throw error;
    } finally {
      processExit.cancel();
    }
  };

  const stop = async () => {
    const currentProcess = agentProcess;
    const currentClient = agentClient;
    agentProcess = null;
    agentClient = null;

    xctestAgentLogger.info(
      'Stopping XCTest agent session for %s target',
      target.kind
    );

    const shutdownTimeout = cancellableDelay(options.shutdownTimeoutMs ?? 5_000);
    let gracefulShutdownCompleted = false;
    try {
      if (currentClient) {
        const gracefulExit = currentProcess
          ? waitForChildProcessExit(currentProcess.subprocess)
          : Promise.resolve();
        await Promise.race([
          (async () => {
            await currentClient.shutdown();
            await gracefulExit;
            gracefulShutdownCompleted = true;
          })(),
          shutdownTimeout.promise,
        ]);
      }
    } finally {
      shutdownTimeout.cancel();
      try {
        await currentClient?.dispose();
      } finally {
        if (!gracefulShutdownCompleted) {
          await stopProcess({ process: currentProcess });
        }
      }
    }
  };

  let disposePromise: Promise<void> | undefined;
  const dispose = () => (disposePromise ??= stop());

  return {
    prepare,
    ensureStarted,
    stop,
    dispose,
  };
};
