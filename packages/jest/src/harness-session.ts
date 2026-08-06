import {
  createHarnessBridge,
  AppBridgeDisconnectedError,
  type HarnessBridge,
  type AppConnection,
} from '@react-native-harness/bridge/server';
import {
  HARNESS_BRIDGE_PATH,
  type HarnessContext,
  type BridgeEvents,
  type TestRunnerEvents,
  type TestExecutionOptions,
  type TestSuiteResult,
} from '@react-native-harness/bridge';
import {
  type AppLaunchOptions,
  type AppSession,
  type HarnessPlatform,
  type HarnessPlatformInitOptions,
  type HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import { createHarnessCache } from '@react-native-harness/cache';
import {
  getMetroInstance,
  waitForMetroBackedAppReady,
  type MetroInstance,
  type MetroWebSocketEndpoint,
  type ReportableEvent,
} from '@react-native-harness/bundler-metro';
import {
  createHarnessPluginManager,
  type FlatHarnessHookContexts,
  type HarnessPlugin,
  type HarnessPluginManager,
  type HarnessRunStatus,
  type HarnessRunSummary,
} from '@react-native-harness/plugins';
import {
  createCrashArtifactWriter,
  createDiagnostics,
  delay,
  logger,
  getTimeoutSignal,
  ensureSignalsDeliverable,
  waitForAbort,
  type Diagnostics,
} from '@react-native-harness/tools';
import {
  getConfig,
  isDiagnosticsEnabled,
  resolveMetroCacheEnabled,
  type Config as HarnessConfig,
  ConfigSchema,
} from '@react-native-harness/config';
import type { Config as JestConfig } from 'jest-runner';
import { preRunMessage } from 'jest-util';
import path from 'node:path';
import { PlatformReadyTimeoutError } from './errors.js';
import { NoRunnerSpecifiedError, RunnerNotFoundError } from './errors.js';
import { createCrashMonitor, type CrashMonitor } from './crash-monitor.js';
import {
  createProcessResetStrategy,
  createRuntimeResetStrategy,
  resolveResetStrategyKind,
  withEscalation,
} from './environment-reset.js';
import { createHookQueue, type HookQueue } from './hook-queue.js';
import {
  createClientLogCollector,
  type ClientLogBuffer,
} from './client-log-handler.js';
import { createActionHooksPlugin } from './action-hooks.js';
import {
  createResourceLockManager,
  type ResourceLockManager,
  type ResourceLease,
} from './resource-lock.js';
import { observeBridgeEvents, observeMetroEvents } from './diagnostics/index.js';
import { resolveHarnessMetroPort } from './metro-port.js';
import { getAdditionalCliArgs } from './cli-args.js';
import {
  logMetroCacheReused,
  logMetroPortFallback,
  logNativeCoverageCollected,
  logRunnerStarting,
  logRunnerStillWaitingInQueue,
  logRunnerWaitingInQueue,
  logTestEnvironmentReady,
  logTestRunHeader,
} from './logs.js';

const sessionLogger = logger.child('runtime');
const defaultResourceLockManager = createResourceLockManager();
const ignorePromiseRejection = () => undefined;
const isBridgeDisconnectError = (error: unknown) =>
  error instanceof Error && error.message === 'App bridge disconnected';
const TEST_RUN_BRIDGE_STABILITY_WAIT_MS = 500;
const DISPOSE_HOOK_TIMEOUT_MS = 5_000;

const waitForBoundedSettlement = async <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<PromiseSettledResult<T> | null> => {
  const timeout = delay(timeoutMs);
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ status: 'fulfilled', value }) as const,
        (reason) => ({ status: 'rejected', reason }) as const
      ),
      timeout.promise.then(() => null),
    ]);
  } finally {
    timeout.cancel();
  }
};

type DisconnectObservableBridge = {
  readonly connection: AppConnection | null;
  on: (event: 'disconnected', listener: () => void) => void;
  off: (event: 'disconnected', listener: () => void) => void;
};

export const waitForBridgeDisconnectOrTimeout = async ({
  bridge,
  connection,
  timeoutMs,
}: {
  bridge: DisconnectObservableBridge;
  connection: AppConnection;
  timeoutMs: number;
}): Promise<boolean> => {
  if (bridge.connection !== connection) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    const onDisconnected = () => {
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      clearTimeout(timer);
      bridge.off('disconnected', onDisconnected);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(bridge.connection !== connection);
    }, timeoutMs);

    bridge.on('disconnected', onDisconnected);
  });
};

// Resolves the NEXT time the bridge reports a 'connected' event, rejecting
// if `signal` aborts first. Deliberately does not use bridge.nextConnection(),
// which would resolve immediately for a stale, already-set connection.
export const waitForNextConnected = ({
  bridge,
  signal,
}: {
  bridge: Pick<HarnessBridge, 'on' | 'off'>;
  signal: AbortSignal;
}): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onConnected = () => { cleanup(); resolve(); };
    const onAbort = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    const cleanup = () => {
      bridge.off('connected', onConnected);
      signal.removeEventListener('abort', onAbort);
    };
    if (signal.aborted) { onAbort(); return; }
    bridge.on('connected', onConnected);
    signal.addEventListener('abort', onAbort, { once: true });
  });

export type HarnessRunState = {
  readonly runId: string;
  readonly startTime: number;
  readonly testFiles: string[];
  readonly watchMode: boolean;
  readonly coverageEnabled: boolean;
  readonly completed?: boolean;
  readonly summary?: HarnessRunSummary;
  readonly status?: HarnessRunStatus;
  readonly error?: unknown;
};

export type HarnessRunTestsOptions = Exclude<TestExecutionOptions, 'platform'>;

export type HarnessSession = {
  readonly config: HarnessConfig;
  readonly context: HarnessContext;
  readonly diagnostics: Diagnostics;
  onTestRunnerEvent: (listener: (event: TestRunnerEvents) => void) => () => void;
  runTestFile: (path: string, options: HarnessRunTestsOptions) => Promise<TestSuiteResult>;
  ensureAppReady: (testFilePath: string) => Promise<void>;
  restartApp: (testFilePath?: string) => Promise<void>;
  resetEnvironment: (testFilePath: string) => Promise<void>;
  resetCrashState: () => void;
  flushClientLogs: () => ClientLogBuffer;
  callHook: HarnessPluginManager<HarnessConfig, HarnessPlatform>['callHook'];
  setRunState: (state: HarnessRunState | null) => void;
  dispose: (reason?: 'normal' | 'abort' | 'error') => Promise<void>;
};

export const getSignalExitCodeForRunState = (
  state: HarnessRunState | null
): number => {
  if (
    state?.completed &&
    state.status === 'passed' &&
    !state.error &&
    (state.summary?.failed ?? 0) === 0
  ) {
    return 0;
  }

  return 1;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Bounds only the init *call* with a readiness timeout; `options.signal` (the
// session-lifetime signal) is passed to `work` unmodified, so a slow init
// call keeps observing real session teardown, not a synthetic timeout abort.
// On timeout this throws PlatformReadyTimeoutError without cancelling `work`
// itself — the caller is expected to abort the session signal as part of
// tearing down, which then cancels the still-inflight call cooperatively.
export const withPlatformReadyTimeout = async <T>(options: {
  timeout: number;
  signal: AbortSignal;
  work: (signal: AbortSignal) => Promise<T>;
}): Promise<T> => {
  const timeoutSignal = getTimeoutSignal(options.timeout);
  const abortWait = waitForAbort(timeoutSignal);
  try {
    return await Promise.race([
      options.work(options.signal),
      abortWait.promise.catch(() => {
        throw new PlatformReadyTimeoutError(options.timeout);
      }),
    ]);
  } finally {
    abortWait.cancel();
  }
};

type AppReadyOptions = {
  metroInstance: MetroInstance;
  bridge: HarnessBridge;
  platformId: string;
  bundleStartTimeout: number;
  readyTimeout: number;
  maxAppRestarts: number;
  crashMonitor: CrashMonitor;
  detectNativeCrashes: boolean;
  restartAppSession: () => Promise<AppSession>;
};

export const waitForStartupCrash = async ({
  crashMonitor,
  detectNativeCrashes,
  testFilePath,
  signal,
}: {
  crashMonitor: CrashMonitor;
  detectNativeCrashes: boolean;
  testFilePath: string;
  signal: AbortSignal;
}) => {
  if (!detectNativeCrashes) {
    return await waitForAbort(signal).promise;
  }

  const watch = crashMonitor.watch(testFilePath, 'startup');
  watch.promise.catch(ignorePromiseRejection); // suppress unhandled-rejection when abort wins race
  const abortWait = waitForAbort(signal);
  try {
    return await Promise.race([watch.promise, abortWait.promise]);
  } finally {
    watch.cancel();
    abortWait.cancel();
  }
};

const waitForAppReady = async (
  base: AppReadyOptions,
  testFilePath: string,
): Promise<void> => {
  const {
    metroInstance,
    bridge,
    platformId,
    bundleStartTimeout,
    readyTimeout,
    maxAppRestarts,
    crashMonitor,
    detectNativeCrashes,
    restartAppSession,
  } = base;

  const logWait = (message: string, ...args: unknown[]) =>
    sessionLogger.debug(`waitForAppReady: ${message}`, ...args);

  return await waitForMetroBackedAppReady({
    metro: metroInstance,
    platformId,
    bundleStartTimeout,
    readyTimeout,
    maxAppRestarts,
    signal: new AbortController().signal,
    startAttempt: async () => {
      logWait('launching app for %s', testFilePath);
      await restartAppSession();
      logWait('launch request completed, waiting for bridge ready');
    },
    waitForReady: async (signal) => {
      logWait('waiting for runtime ready');
      // Listen for the NEXT 'connected' event rather than using nextConnection(),
      // because nextConnection() returns the existing connection immediately if one
      // is already set. waitForReady is called before startAttempt, so a stale
      // connection from a previous run would resolve the promise before startAttempt
      // even restarts the app — leaving bridge.connection null after the restart.
      await waitForNextConnected({ bridge, signal });
      logWait('runtime ready received');
    },
    waitForCrash: async (signal) => {
      logWait('waiting for crash or runtime ready');
      return await waitForStartupCrash({
        crashMonitor,
        detectNativeCrashes,
        testFilePath,
        signal,
      });
    },
    onAttemptStart: () => {
      logWait('beginning launch attempt for %s', testFilePath);
    },
    onAttemptReset: () => {
      logWait('resetting launch attempt state');
    },
  });
};

const getDefaultResourceLockKey = (platform: HarnessPlatform): string =>
  `${platform.platformId}:${platform.name}`;

const buildBridgeHookScheduler = (
  hooks: HookQueue,
  pluginManager: HarnessPluginManager<HarnessConfig, HarnessPlatform>,
  getCurrentRunId: () => string | undefined,
) => (event: BridgeEvents) => {
  const runId = getCurrentRunId();
  if (!runId) return;

  const schedule = <TName extends keyof FlatHarnessHookContexts<object, HarnessConfig, HarnessPlatform>>(
    name: TName,
    payload: Omit<FlatHarnessHookContexts<object, HarnessConfig, HarnessPlatform>[TName], 'plugin' | 'logger' | 'projectRoot' | 'config' | 'runner' | 'platform' | 'state' | 'timestamp' | 'abortSignal' | 'meta'>,
  ) => hooks.schedule(() => pluginManager.callHook(name, payload));

  switch (event.type) {
    case 'collection-started':
      return schedule('collection:started', { runId, file: event.file });
    case 'collection-finished':
      return schedule('collection:finished', { runId, file: event.file, duration: event.duration, totalTests: event.totalTests });
    case 'suite-started':
      return schedule('suite:started', { runId, file: event.file, name: event.name });
    case 'suite-finished':
      return schedule('suite:finished', { runId, file: event.file, name: event.name, duration: event.duration, status: event.status, error: event.error });
    case 'test-started':
      return schedule('test:started', { runId, file: event.file, suite: event.suite, name: event.name });
    case 'test-finished':
      return schedule('test:finished', { runId, file: event.file, suite: event.suite, name: event.name, duration: event.duration, status: event.status, error: event.error });
    case 'module-bundling-started':
      return schedule('metro:bundle-started', { runId, target: 'module', file: event.file });
    case 'module-bundling-finished':
      return schedule('metro:bundle-finished', { runId, target: 'module', file: event.file, duration: event.duration });
    case 'module-bundling-failed':
      return schedule('metro:bundle-failed', { runId, target: 'module', file: event.file, duration: event.duration, error: event.error });
    case 'setup-file-bundling-started':
      return schedule('metro:bundle-started', { runId, target: 'setupFile', file: event.file, setupType: event.setupType });
    case 'setup-file-bundling-finished':
      return schedule('metro:bundle-finished', { runId, target: 'setupFile', file: event.file, setupType: event.setupType, duration: event.duration });
    case 'setup-file-bundling-failed':
      return schedule('metro:bundle-failed', { runId, target: 'setupFile', file: event.file, setupType: event.setupType, duration: event.duration, error: event.error });
  }
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const applyEnvVars = (
  harnessConfig: HarnessConfig,
  globalConfig: JestConfig.GlobalConfig,
): void => {
  if (globalConfig.collectCoverage) {
    process.env.RN_HARNESS_COLLECT_COVERAGE = 'true';
    if (harnessConfig.coverage?.root) {
      process.env.RN_HARNESS_COVERAGE_ROOT = harnessConfig.coverage.root;
    }
  }
  if (harnessConfig.disableViewFlattening) {
    process.env.RN_HARNESS_VIEW_FLATTENING = 'false';
  }
};

/**
 * Logs the "Reusing Metro cache" message when persistent Metro caching is
 * enabled and the cache is warm. `projectRoot` must be the config-resolved
 * project root so the warmth check looks at the same directory Metro caches
 * into.
 */
export const maybeLogMetroCacheReused = (options: {
  config: Pick<HarnessConfig, 'cache' | 'unstable__enableMetroCache'>;
  projectRoot: string;
  platform: HarnessPlatform;
}): void => {
  if (!resolveMetroCacheEnabled(options.config)) {
    return;
  }

  if (
    createHarnessCache({ projectRoot: options.projectRoot }).isWarm('metro')
  ) {
    logMetroCacheReused(options.platform);
  }
};

const loadConfig = async (globalConfig: JestConfig.GlobalConfig): Promise<{
  harnessConfig: HarnessConfig;
  platform: HarnessPlatform;
  projectRoot: string;
  configProjectRoot: string;
}> => {
  const projectRoot = globalConfig.rootDir;
  const { config: rawConfig, projectRoot: configProjectRoot } =
    await getConfig(projectRoot);

  const cliArgs = getAdditionalCliArgs();
  let harnessConfig = cliArgs.metroPort != null
    ? ConfigSchema.parse({ ...rawConfig, metroPort: cliArgs.metroPort })
    : rawConfig;

  if (process.env.PRE_RUN_HOOK || process.env.AFTER_RUN_HOOK) {
    harnessConfig = ConfigSchema.parse({
      ...harnessConfig,
      plugins: [...(harnessConfig.plugins ?? []), createActionHooksPlugin()],
    });
  }

  if (
    harnessConfig.webSocketPort != null &&
    harnessConfig.webSocketPort !== harnessConfig.metroPort
  ) {
    logger.warn(
      `Config option "webSocketPort" is deprecated and ignored. Harness now uses metroPort (${harnessConfig.metroPort}) for bridge traffic.`
    );
  }

  const selectedRunnerName = cliArgs.harnessRunner ?? harnessConfig.defaultRunner;
  if (!selectedRunnerName) throw new NoRunnerSpecifiedError();

  const platform = harnessConfig.runners.find((r) => r.name === selectedRunnerName);
  if (!platform) throw new RunnerNotFoundError(selectedRunnerName);

  return { harnessConfig, platform, projectRoot, configProjectRoot };
};

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

export const createHarnessSession = async (
  globalConfig: JestConfig.GlobalConfig,
  { lockManager = defaultResourceLockManager }: { lockManager?: ResourceLockManager } = {},
): Promise<HarnessSession> => {
  preRunMessage.remove(process.stderr);

  const setupStartedAt = Date.now();
  const { harnessConfig, platform, projectRoot, configProjectRoot } = await loadConfig(globalConfig);
  applyEnvVars(harnessConfig, globalConfig);

  const diagnostics = createDiagnostics({
    enabled: isDiagnosticsEnabled(harnessConfig),
  });
  diagnostics.record({
    label: 'session.config.load',
    duration: Date.now() - setupStartedAt,
  });

  sessionLogger.debug(
    'creating session for runner=%s platform=%s',
    platform.name,
    platform.platformId,
  );

  // Single, session-lifetime AbortController: it aborts on early SIGTERM/SIGINT
  // during setup (below) and, once the session is up, in dispose()'s finally
  // (unchanged lifetime). It is the one signal the plugin manager and platform
  // runner see for the entire session, so its abort reaches every long-lived
  // child the runner threads it into.
  ensureSignalsDeliverable();
  const sessionController = new AbortController();
  let receivedEarlySignal = false;
  const onEarlySignal = () => {
    receivedEarlySignal = true;
    sessionController.abort();
  };
  process.once('SIGTERM', onEarlySignal);
  process.once('SIGINT', onEarlySignal);

  const resourceLockKey = await (platform.getResourceLockKey?.() ?? getDefaultResourceLockKey(platform));
  let didWaitForResourceLock = false;
  let lastStillWaitingLogAt = 0;

  logTestRunHeader(platform);

  const resourceLease = await diagnostics.measure(
    'session.lock.wait',
    () =>
      lockManager.acquire(resourceLockKey, {
        signal: sessionController.signal,
        onWait: () => {
          didWaitForResourceLock = true;
          logRunnerWaitingInQueue(platform);
          sessionLogger.debug('waiting in queue for runner=%s key=%s', platform.name, resourceLockKey);
        },
        onStillWaiting: (elapsedMs) => {
          if (elapsedMs - lastStillWaitingLogAt < 5000) return;
          lastStillWaitingLogAt = elapsedMs;
          logRunnerStillWaitingInQueue(platform);
          sessionLogger.debug('still waiting in queue for runner=%s key=%s elapsedMs=%d', platform.name, resourceLockKey, elapsedMs);
        },
      }),
    { lockKey: resourceLockKey }
  );

  if (didWaitForResourceLock) logRunnerStarting(platform);
  sessionLogger.debug('resource lock acquired for runner=%s key=%s', platform.name, resourceLockKey);

  // Hoisted so the outer catch can release it even if an error occurs after
  // port resolution but before the inner try/catch (e.g. bridge creation failure).
  let metroPortLease: ResourceLease | null = null;

  try {
    const portResolveSpan = diagnostics.start('session.port.resolve');
    let resolution: Awaited<ReturnType<typeof resolveHarnessMetroPort>>;
    try {
      resolution = await resolveHarnessMetroPort({
        config: harnessConfig,
        platform,
        resourceLockManager: lockManager,
        signal: sessionController.signal,
      });
    } catch (error) {
      portResolveSpan.fail(error);
      throw error;
    }
    portResolveSpan.end({
      port: resolution.config.metroPort,
      didFallback: resolution.didFallback,
    });
    metroPortLease = resolution.metroPortLease;
    const { config: runtimeConfig, initialMetroPort, didFallback } = resolution;

    if (didFallback) logMetroPortFallback(initialMetroPort, runtimeConfig.metroPort);

    maybeLogMetroCacheReused({
      config: runtimeConfig,
      projectRoot: configProjectRoot,
      platform,
    });

    const pluginManager = createHarnessPluginManager<HarnessConfig, HarnessPlatform>({
      plugins: (runtimeConfig.plugins ?? []) as Array<HarnessPlugin<object, HarnessConfig, HarnessPlatform>>,
      projectRoot,
      config: runtimeConfig,
      runner: platform,
      abortSignal: sessionController.signal,
    });

    const hooks = createHookQueue();
    let currentRun: HarnessRunState | null = null;
    const getCurrentRunId = () => currentRun?.runId;
    const clientLogCollector = createClientLogCollector();

    const context: HarnessContext = { platform };
    const crashArtifactWriter = createCrashArtifactWriter({
      runnerName: platform.name,
      platformId: platform.platformId,
      rootDir: path.join(projectRoot, '.harness', 'crash-reports'),
    });

    const bridge = await diagnostics.measure('session.bridge.init', () =>
      createHarnessBridge({
        noServer: true,
        timeout: runtimeConfig.bridgeTimeout,
        context,
      })
    );
    sessionLogger.debug('bridge initialized on Metro websocket path %s', HARNESS_BRIDGE_PATH);

    let metroInstance: MetroInstance;
    let platformInstance: HarnessPlatformRunner;
    const initialized = {
      metro: null as MetroInstance | null,
      platform: null as HarnessPlatformRunner | null,
    };
    let initializationCancelled = false;
    // Noop until the Metro instance resolves and the deriver is attached.
    let disposeMetroDiagnostics: () => void = () => undefined;

    try {
      [metroInstance, platformInstance] = await Promise.all([
        diagnostics.measure('metro.init', () =>
          getMetroInstance(
            {
              projectRoot,
              harnessConfig: runtimeConfig,
              websocketEndpoints: {
                [HARNESS_BRIDGE_PATH]: bridge.ws as unknown as MetroWebSocketEndpoint,
              },
              watchMode: globalConfig.watch || globalConfig.watchAll,
            },
            sessionController.signal,
          ).then((instance) => {
            if (initializationCancelled) {
              return instance.dispose().then(() => instance);
            }
            initialized.metro = instance;
            sessionLogger.debug('Metro initialized');
            // Attach the Metro diagnostics deriver before the eager prewarm
            // fires so its bundle build/request events land in the trace.
            disposeMetroDiagnostics = observeMetroEvents(instance.events, diagnostics);
            if (runtimeConfig.eagerPrewarm !== false) {
              // Kick off the first bundle build while the platform is still booting.
              // prewarm() memoizes this first call, so its session-lifetime setup
              // signal is the one that matters — later callers' signals cannot
              // cancel it. Not awaited: metro.init must resolve immediately.
              const prewarmSpan = diagnostics.start('metro.prewarm');
              instance
                .prewarm({
                  platform: platform.platformId,
                  signal: sessionController.signal,
                })
                .then((completed) => prewarmSpan.end({ completed }))
                // Swallow AbortError on teardown so it never becomes an
                // unhandled rejection; non-abort failures resolve false.
                .catch((error) => prewarmSpan.fail(error));
            }
            return instance;
          })
        ),
        diagnostics.measure(
          'platform.init',
          () =>
            withPlatformReadyTimeout({
              timeout: runtimeConfig.platformReadyTimeout,
              signal: sessionController.signal,
              work: async (signal) => {
                return await import(platform.runner).then((module) =>
                  module.default(platform.config, runtimeConfig, {
                    signal,
                    crashArtifactWriter,
                    diagnostics,
                  } satisfies HarnessPlatformInitOptions),
                ).then((instance) => {
                  if (initializationCancelled) {
                    return instance.dispose().then(() => instance);
                  }
                  initialized.platform = instance;
                  sessionLogger.debug('platform runner initialized');
                  return instance;
                });
              },
            }),
          { runner: platform.runner, platformId: platform.platformId }
        ),
      ]);
    } catch (error) {
      // Roll back every resource whose initialization won a concurrent race.
      // Leases are released by the outer catch.
      initializationCancelled = true;
      sessionController.abort();
      disposeMetroDiagnostics();
      await Promise.allSettled([
        bridge.dispose(),
        initialized.metro?.dispose(),
        initialized.platform?.dispose(),
      ]);
      throw error;
    }

    const appLaunchOptions = (platform.config as { appLaunchOptions?: AppLaunchOptions }).appLaunchOptions;

    let currentAppSession: AppSession | null = null;
    const crashMonitor = createCrashMonitor();

    const disposeCurrentAppSession = async () => {
      const session = currentAppSession;
      currentAppSession = null;
      crashMonitor.setAppSession(null);
      if (session) {
        await session.dispose();
      }
    };

    const restartAppSession = async (): Promise<AppSession> => {
      await crashMonitor.stop();
      await disposeCurrentAppSession();
      const session = await diagnostics.measure('app.session.create', () =>
        platformInstance.createAppSession(appLaunchOptions)
      );
      currentAppSession = session;
      crashMonitor.setAppSession(session);
      await crashMonitor.start();
      return session;
    };

    // Pre-build the options that are constant across all app-ready calls;
    // only testFilePath varies per call.
    const appReadyBaseOptions: AppReadyOptions = {
      metroInstance,
      bridge,
      platformId: platform.platformId,
      bundleStartTimeout: runtimeConfig.bundleStartTimeout ?? 60000,
      readyTimeout: runtimeConfig.bridgeTimeout,
      maxAppRestarts: runtimeConfig.maxAppRestarts ?? 2,
      crashMonitor,
      detectNativeCrashes: runtimeConfig.detectNativeCrashes !== false,
      restartAppSession,
    };

    // --- Event listeners ---

    const bridgeEventListener = buildBridgeHookScheduler(hooks, pluginManager, getCurrentRunId);

    const onMetroEvent = (event: ReportableEvent) => {
      const runId = getCurrentRunId();
      if (runId && event.type === 'client_log') {
        hooks.schedule(() => pluginManager.callHook('metro:client-log', { runId, level: event.level, data: event.data }));
      }
    };

    const flushClientLogs = (): ClientLogBuffer => clientLogCollector.flush();

    const clientLogListener = clientLogCollector.handleEvent;
    const testRunnerEventListeners = new Set<(event: TestRunnerEvents) => void>();
    const onTestRunnerEvent = (event: BridgeEvents) => {
      if (
        event.type === 'test-started' ||
        event.type === 'test-finished' ||
        event.type === 'suite-started' ||
        event.type === 'suite-finished' ||
        event.type === 'file-started' ||
        event.type === 'file-finished'
      ) {
        testRunnerEventListeners.forEach((listener) => listener(event));
      }
    };

    const onConnected = (conn: AppConnection) => {
      const runId = getCurrentRunId();
      if (!runId) return;
      hooks.schedule(() => pluginManager.callHook('runtime:ready', { runId, device: conn.device }));
    };

    const onDisconnected = () => {
      const runId = getCurrentRunId();
      if (!runId) return;
      hooks.schedule(() => pluginManager.callHook('runtime:disconnected', { runId, reason: 'bridge-disconnected' }));
      if (runtimeConfig.detectNativeCrashes !== false) {
        crashMonitor.handleBridgeDisconnect();
      }
    };

    bridge.on('connected', onConnected);
    bridge.on('disconnected', onDisconnected);
    bridge.on('event', bridgeEventListener);
    bridge.on('event', onTestRunnerEvent);
    metroInstance.events.addListener(onMetroEvent);
    if (runtimeConfig.forwardClientLogs) {
      metroInstance.events.addListener(clientLogListener);
    }

    const disposeBridgeDiagnostics = observeBridgeEvents(bridge, diagnostics);

    sessionLogger.debug('registered runtime, bridge, and Metro listeners');

    // --- Dispose ---

    let disposePromise: Promise<void> | null = null;

    const disposeOnce = async (reason: 'normal' | 'abort' | 'error') => {
      sessionLogger.debug('disposing session (reason=%s)', reason);
      const disposeSpan = diagnostics.start('dispose.total', { reason });
      let hookError: unknown;

      // Abort only cancels finite/in-flight work. Ownership remains explicit
      // below, so this cannot race a platform or app-session disposal path.
      sessionController.abort();

      const hookWork = (async () => {
        await hooks.drain();
        await pluginManager.callHook('harness:after-run', {
          runId: currentRun?.runId,
          reason,
          summary: currentRun?.summary,
          status: currentRun?.status,
          error: currentRun?.error,
        });
        await hooks.drain();
        await pluginManager.callHook('harness:before-dispose', {
          runId: currentRun?.runId,
          reason,
          summary: currentRun?.summary,
          status: currentRun?.status,
          error: currentRun?.error,
        });
        await hooks.drain();
      })();
      const hookResult = await waitForBoundedSettlement(
        hookWork,
        DISPOSE_HOOK_TIMEOUT_MS
      );
      if (hookResult === null) {
        hookError = new Error(
          `Timed out after ${DISPOSE_HOOK_TIMEOUT_MS}ms while running disposal hooks.`
        );
      } else if (hookResult.status === 'rejected') {
        hookError = hookResult.reason;
      }

      if (runtimeConfig.forwardClientLogs) {
        metroInstance.events.removeListener(clientLogListener);
      }
      metroInstance.events.removeListener(onMetroEvent);
      bridge.off('connected', onConnected);
      bridge.off('disconnected', onDisconnected);
      bridge.off('event', bridgeEventListener);
      bridge.off('event', onTestRunnerEvent);
      disposeMetroDiagnostics();
      disposeBridgeDiagnostics();

      const nativeCoverageConfig = runtimeConfig.coverage?.native?.ios;
      if (nativeCoverageConfig?.pods?.length && platformInstance.collectNativeCoverage) {
        try {
          await crashMonitor.stop();
          await disposeCurrentAppSession();
          const lcovPath = await platformInstance.collectNativeCoverage({
            pods: nativeCoverageConfig.pods,
            outputDir: projectRoot,
          });
          if (lcovPath) {
            logNativeCoverageCollected(lcovPath);
          }
        } catch (error) {
          sessionLogger.warn('failed to collect native coverage: %s', error);
        }
      }

      // The app session (and its log streams) must finish before platform
      // disposal can remove the underlying device. Run independent cleanup
      // all-settled so one failure cannot strand another owned resource.
      const appCleanup = await Promise.allSettled([
        crashMonitor.dispose(),
        disposeCurrentAppSession(),
      ]);
      const infrastructureCleanup = await Promise.allSettled([
        bridge.dispose(),
        platformInstance.dispose(),
        metroInstance.dispose(),
        metroPortLease?.release(),
      ]);
      const leaseCleanup = await Promise.allSettled([resourceLease.release()]);
      const cleanupError = [...appCleanup, ...infrastructureCleanup, ...leaseCleanup]
        .find((result): result is PromiseRejectedResult => result.status === 'rejected')
        ?.reason;

      sessionLogger.debug('session resources disposed');

      if (hookError) {
        disposeSpan.fail(hookError);
        throw hookError;
      }
      if (cleanupError) {
        disposeSpan.fail(cleanupError);
        throw cleanupError;
      }
      disposeSpan.end();
    };

    const dispose = (reason: 'normal' | 'abort' | 'error' = 'normal') => {
      disposePromise ??= disposeOnce(reason);
      return disposePromise;
    };

    // Switch from setup-phase signal handling to dispose-based handling now
    // that all infrastructure is up.
    process.off('SIGTERM', onEarlySignal);
    process.off('SIGINT', onEarlySignal);
    const onSignal = () => {
      const exitCode = getSignalExitCodeForRunState(currentRun);
      void dispose('abort').then(
        () => process.exit(exitCode),
        () => process.exit(1),
      );
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);

    // --- Startup hooks ---

    try {
      await pluginManager.callHook('harness:before-creation', { appLaunchOptions });
      await hooks.drain();
      await pluginManager.callHook('harness:before-run', { appLaunchOptions });
      await hooks.drain();
    } catch (error) {
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      await dispose('error');
      throw error;
    }

    logTestEnvironmentReady(platform);
    diagnostics.record({
      label: 'session.setup',
      duration: Date.now() - setupStartedAt,
    });
    sessionLogger.debug('session ready');

    // --- Public API ---

    const ensureAppReady = async (testFilePath: string): Promise<void> => {
      await hooks.drain();
      sessionLogger.debug('ensuring app is ready for %s', testFilePath);
      const appReadySpan = diagnostics.start('app.ready.total');

      if (crashMonitor.isAlive() && bridge.connection !== null && currentAppSession) {
        const state = await currentAppSession.getState();
        if (state.status === 'running') {
          sessionLogger.debug('reusing existing ready app for %s', testFilePath);
          appReadySpan.end({ file: testFilePath, reused: true });
          return;
        }
      }

      crashMonitor.reset();
      sessionLogger.debug('app not ready, waiting for launch and runtime readiness');
      try {
        await waitForAppReady(appReadyBaseOptions, testFilePath);
      } catch (error) {
        appReadySpan.fail(error, { file: testFilePath, reused: false });
        throw error;
      }
      await hooks.drain();
      sessionLogger.debug('app is ready for %s', testFilePath);
      appReadySpan.end({ file: testFilePath, reused: false });
    };

    // Shared by restartApp (crash/timeout recovery) and the 'process' reset
    // strategy: kill the current app session and either wait for a fresh one
    // to become ready for testFilePath, or (no testFilePath) just launch one.
    const performRestart = async (testFilePath?: string): Promise<void> => {
      await crashMonitor.stop();
      await disposeCurrentAppSession();

      if (testFilePath) {
        await ensureAppReady(testFilePath);
      } else {
        const session = await platformInstance.createAppSession(appLaunchOptions);
        currentAppSession = session;
        crashMonitor.setAppSession(session);
        crashMonitor.reset();
        await crashMonitor.start();
      }
    };

    const restartApp = async (testFilePath?: string): Promise<void> => {
      await hooks.drain();
      const reason: 'stop-and-ensure-ready' | 'direct-restart' = testFilePath
        ? 'stop-and-ensure-ready'
        : 'direct-restart';
      sessionLogger.debug(
        'restarting app (testFile=%s mode=%s)',
        testFilePath ?? 'n/a',
        reason,
      );
      const restartSpan = diagnostics.start('app.restart', { reason });

      try {
        await performRestart(testFilePath);
        await hooks.drain();
        sessionLogger.debug('restart completed');
        restartSpan.end();
      } catch (error) {
        restartSpan.fail(error);
        throw error;
      }
    };

    const processResetStrategy = createProcessResetStrategy({
      restart: performRestart,
    });
    const runtimeResetStrategy = createRuntimeResetStrategy({
      getConnection: () => bridge.connection,
      expectDisconnect: crashMonitor.expectDisconnect,
      waitForReconnect: (signal) => waitForNextConnected({ bridge, signal }),
      // Pending rpc.invoke calls reject with AppBridgeDisconnectedError when
      // the app connection drops (see bridge server's disconnect()).
      isDisconnectError: (error) => error instanceof AppBridgeDisconnectedError,
      timeoutMs: runtimeConfig.bundleStartTimeout ?? 60000,
    });

    const resetEnvironment = async (testFilePath: string): Promise<void> => {
      const requestedKind = resolveResetStrategyKind(
        runtimeConfig.resetEnvironmentBetweenTestFiles,
      );
      if (requestedKind === null) {
        return;
      }

      await hooks.drain();
      sessionLogger.debug(
        'resetting environment (testFile=%s kind=%s)',
        testFilePath,
        requestedKind,
      );

      let escalated = false;
      const strategy = requestedKind === 'runtime'
        ? withEscalation(runtimeResetStrategy, processResetStrategy, {
            onEscalate: (error) => {
              escalated = true;
              sessionLogger.debug(
                'runtime reset failed, escalating to process restart: %s',
                error,
              );
            },
          })
        : processResetStrategy;

      const resetSpan = diagnostics.start('app.reset', { requested: requestedKind });
      const performed = () => (escalated ? 'process' : requestedKind);

      try {
        await strategy.reset({ testFilePath });
        await hooks.drain();
        sessionLogger.debug('environment reset completed');
        resetSpan.end({ performed: performed(), escalated });
      } catch (error) {
        resetSpan.fail(error, { performed: performed(), escalated });
        throw error;
      }
    };

    const runTestFile = async (
      testPath: string,
      options: HarnessRunTestsOptions,
    ): Promise<TestSuiteResult> => {
      await hooks.drain();
      const conn = bridge.connection;
      if (!conn) throw new Error('No active app connection');
      sessionLogger.debug('running test file on client: %s', testPath);

      if (runtimeConfig.detectNativeCrashes === false) {
        const result = await conn.runTests(testPath, { ...options, runner: platform.runner });
        await hooks.drain();
        return result;
      }

      const crashWatch = crashMonitor.watch(testPath, 'execution');
      // Attach a handler now so the rejection is always observed, whether the
      // crash wins the race or cancel() is called after the test run wins.
      crashWatch.promise.catch(ignorePromiseRejection);
      try {
        const testRunPromise = conn.runTests(testPath, {
          ...options,
          runner: platform.runner,
        });
        const result = await Promise.race([testRunPromise, crashWatch.promise]);
        const bridgeDisconnected = await waitForBridgeDisconnectOrTimeout({
          bridge,
          connection: conn,
          timeoutMs: TEST_RUN_BRIDGE_STABILITY_WAIT_MS,
        });

        if (bridgeDisconnected) {
          return await crashWatch.promise;
        }

        await hooks.drain();
        return result;
      } catch (error) {
        if (isBridgeDisconnectError(error)) {
          const result = await crashWatch.promise;
          await hooks.drain();
          return result;
        }

        throw error;
      } finally {
        crashWatch.cancel();
      }
    };

    return {
      config: runtimeConfig,
      context,
      diagnostics,
      onTestRunnerEvent: (listener) => {
        testRunnerEventListeners.add(listener);
        return () => {
          testRunnerEventListeners.delete(listener);
        };
      },
      runTestFile,
      ensureAppReady,
      restartApp,
      resetEnvironment,
      resetCrashState: () => crashMonitor.reset(),
      flushClientLogs,
      callHook: async (name, payload) => {
        await hooks.drain();
        await diagnostics.measure(
          'plugin.hook',
          () => pluginManager.callHook(name, payload),
          { hook: String(name) }
        );
        await hooks.drain();
      },
      setRunState: (state) => {
        currentRun = state;
      },
      dispose: async (reason = 'normal') => {
        try {
          await dispose(reason);
        } finally {
          process.off('SIGTERM', onSignal);
          process.off('SIGINT', onSignal);
        }
      },
    };
  } catch (error) {
    process.off('SIGTERM', onEarlySignal);
    process.off('SIGINT', onEarlySignal);
    // Cancels any inflight init work still holding sessionController.signal
    // (e.g. a platform init call abandoned after a readiness timeout race).
    sessionController.abort();
    await Promise.allSettled([resourceLease.release(), metroPortLease?.release()]);
    if (receivedEarlySignal) {
      process.exit(1);
    }
    throw error;
  }
};
