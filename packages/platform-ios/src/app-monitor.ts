import {
  CrashWatchCancelledError,
  NativeCrashError,
  type AppCrashDetails,
  type AppLifecycleMonitor,
  type AppLifecyclePhase,
  type CrashArtifactWriter,
  type CrashDetailsLookupOptions,
  type LaunchCompletedEvent,
  type NativeCrashDetails,
} from '@react-native-harness/platforms';
import {
  escapeRegExp,
  logger,
  type Subprocess,
} from '@react-native-harness/tools';
import * as devicectl from './xcrun/devicectl.js';
import * as simctl from './xcrun/simctl.js';
import {
  collectCrashArtifacts,
  waitForCrashArtifact,
} from './crash-diagnostics.js';

const iosAppMonitorLogger = logger.child('ios-app-monitor');

const MAX_RECENT_LOG_LINES = 200;
const MAX_RECENT_CRASH_ARTIFACTS = 10;
const CRASH_ARTIFACT_SETTLE_DELAY_MS = 300;
const PROCESS_POLL_INTERVAL_MS = 250;
const POST_LAUNCH_CRASH_SWEEP_DELAY_MS = 1000;
const RECENT_LAUNCH_WINDOW_MS = 5000;
const SUSPICION_WINDOW_MS = 3000;

type TimedLogLine = {
  line: string;
  occurredAt: number;
};

type IosCrashArtifact = AppCrashDetails & {
  occurredAt: number;
};

const getSignal = (line: string) => {
  const namedSignalMatch = line.match(/\b(SIG[A-Z0-9]+)\b/);

  if (namedSignalMatch) {
    return namedSignalMatch[1];
  }

  const signalNumberMatch = line.match(/signal\s+(\d+)/i);

  if (signalNumberMatch) {
    return `signal ${signalNumberMatch[1]}`;
  }

  const exceptionTypeMatch = line.match(/\b(EXC_[A-Z_]+)\b/);

  if (exceptionTypeMatch) {
    return exceptionTypeMatch[1];
  }

  return undefined;
};

const getProcessName = (line: string, processNames: string[]) =>
  processNames.find((processName) =>
    new RegExp(`\\b${escapeRegExp(processName)}\\b`).test(line),
  );

const getPid = (line: string, processNames: string[]) => {
  for (const processName of processNames) {
    const match = line.match(
      new RegExp(
        `\\b${escapeRegExp(processName)}(?:\\([^)]*\\))?\\[(\\d+)(?::[^\\]]+)?\\]`,
      ),
    );

    if (match) {
      return Number(match[1]);
    }
  }

  const genericMatch = line.match(/\[(\d+)\]/);

  if (genericMatch) {
    return Number(genericMatch[1]);
  }

  return undefined;
};

const isRelevantProcessLine = (line: string, processNames: string[]) =>
  processNames.some((processName) =>
    new RegExp(`\\b${escapeRegExp(processName)}(?:\\[|\\b)`).test(line),
  );

const isRelevantProcessLogLine = (line: string, processNames: string[]) =>
  processNames.some((processName) =>
    new RegExp(`\\b${escapeRegExp(processName)}(?:\\([^)]*\\))?\\[`).test(
      line,
    ),
  );

const isCrashSignal = (line: string) =>
  /uncaught exception|terminating app due to|fatal error|EXC_[A-Z_]+|termination reason|watchdog/i.test(
    line,
  ) || /\bSIG[A-Z]{2,}\b/.test(line);

const classifyIosCrashKind = (line: string): AppCrashDetails['kind'] => {
  if (/watchdog/i.test(line)) {
    return 'watchdog';
  }

  if (/EXC_[A-Z_]+|SIG[A-Z]+|fatal error|uncaught exception|terminating app due to/i.test(line)) {
    return 'native-crash';
  }

  return 'unknown';
};

const getIosLogCrashDetails = ({
  line,
  processNames,
  platform,
}: {
  line: string;
  processNames: string[];
  platform: 'ios-simulator' | 'ios-device';
}): AppCrashDetails => {
  const exceptionMatch = line.match(/exception[^:]*:\s*([^,]+)/i);

  return {
    platform,
    kind: classifyIosCrashKind(line),
    confidence: 'medium',
    source: 'logs',
    summary: line.trim(),
    signal: getSignal(line),
    exceptionType: exceptionMatch?.[1]?.trim(),
    processName: getProcessName(line, processNames),
    pid: getPid(line, processNames),
    rawLines: [line],
  };
};

type IosMonitorSignal = {
  type: 'crash_suspected';
  crashDetails: AppCrashDetails;
};

export const createUnifiedLogEvent = ({
  line,
  processNames,
  platform,
}: {
  line: string;
  processNames: string[];
  platform: 'ios-simulator' | 'ios-device';
}): IosMonitorSignal | null => {
  if (!isRelevantProcessLine(line, processNames)) {
    return null;
  }

  if (!isCrashSignal(line)) {
    return null;
  }

  return {
    type: 'crash_suspected',
    crashDetails: getIosLogCrashDetails({
      line,
      processNames,
      platform,
    }),
  };
};

const createAppMonitorBase = () => {
  let recentLogLines: TimedLogLine[] = [];
  let recentCrashArtifacts: IosCrashArtifact[] = [];

  const recordLogLine = (line: string) => {
    recentLogLines = [...recentLogLines, { line, occurredAt: Date.now() }].slice(
      -MAX_RECENT_LOG_LINES,
    );
  };

  const recordCrashArtifact = (details: AppCrashDetails) => {
    recentCrashArtifacts = [
      ...recentCrashArtifacts,
      {
        ...details,
        occurredAt: details.occurredAt ?? Date.now(),
      },
    ].slice(-MAX_RECENT_CRASH_ARTIFACTS);
  };

  const getLatestCrashArtifact = (
    options: CrashDetailsLookupOptions,
  ): AppCrashDetails | null => {
    const matchingByPid = options.pid
      ? recentCrashArtifacts.filter((artifact) => artifact.pid === options.pid)
      : [];
    const matchingByProcess = options.processName
      ? recentCrashArtifacts.filter(
          (artifact) => artifact.processName === options.processName,
        )
      : [];
    const candidates =
      matchingByPid.length > 0
        ? matchingByPid
        : matchingByProcess.length > 0
          ? matchingByProcess
          : recentCrashArtifacts;
    const preferredCandidates = candidates.filter(
      (artifact) => artifact.artifactType === 'ios-crash-report',
    );
    const prioritizedCandidates =
      preferredCandidates.length > 0 ? preferredCandidates : candidates;

    return (
      [...prioritizedCandidates].sort(
        (left, right) =>
          Math.abs(left.occurredAt - options.occurredAt) -
          Math.abs(right.occurredAt - options.occurredAt),
      )[0] ?? null
    );
  };

  const getRecentLogLines = () => recentLogLines;

  return {
    recordLogLine,
    recordCrashArtifact,
    getLatestCrashArtifact,
    getRecentLogLines,
    reset: () => {
      recentLogLines = [];
      recentCrashArtifacts = [];
    },
  };
};

const mergeCrashDetails = (
  existing?: AppCrashDetails,
  incoming?: AppCrashDetails | null,
): AppCrashDetails | undefined => {
  if (!existing) {
    return incoming ?? undefined;
  }

  if (!incoming) {
    return existing;
  }

  return {
    platform: incoming.platform ?? existing.platform,
    kind: incoming.kind ?? existing.kind,
    confidence: incoming.confidence ?? existing.confidence,
    occurredAt: incoming.occurredAt ?? existing.occurredAt,
    launchId: incoming.launchId ?? existing.launchId,
    source: incoming.source ?? existing.source,
    summary: incoming.summary ?? existing.summary,
    signal: incoming.signal ?? existing.signal,
    exceptionType: incoming.exceptionType ?? existing.exceptionType,
    processName: incoming.processName ?? existing.processName,
    pid: incoming.pid ?? existing.pid,
    stackTrace: incoming.stackTrace ?? existing.stackTrace,
    rawLines: incoming.rawLines ?? existing.rawLines,
    artifactType: incoming.artifactType ?? existing.artifactType,
    artifactPath: incoming.artifactPath ?? existing.artifactPath,
  };
};

const mergeNativeCrashDetails = ({
  phase,
  initial,
  enriched,
  fallbackSummary,
}: {
  phase: AppLifecyclePhase;
  initial?: AppCrashDetails;
  enriched?: AppCrashDetails | null;
  fallbackSummary?: string;
}): NativeCrashDetails => ({
  phase,
  platform: enriched?.platform ?? initial?.platform,
  kind: enriched?.kind ?? initial?.kind,
  confidence: enriched?.confidence ?? initial?.confidence,
  occurredAt: enriched?.occurredAt ?? initial?.occurredAt,
  launchId: enriched?.launchId ?? initial?.launchId,
  source: enriched?.source ?? initial?.source,
  summary: enriched?.summary ?? initial?.summary ?? fallbackSummary,
  signal: enriched?.signal ?? initial?.signal,
  exceptionType: enriched?.exceptionType ?? initial?.exceptionType,
  processName: enriched?.processName ?? initial?.processName,
  pid: enriched?.pid ?? initial?.pid,
  stackTrace: enriched?.stackTrace ?? initial?.stackTrace,
  rawLines: enriched?.rawLines ?? initial?.rawLines,
  artifactType: enriched?.artifactType ?? initial?.artifactType,
  artifactPath: enriched?.artifactPath ?? initial?.artifactPath,
});

const normalizeCrashDetails = (
  details: AppCrashDetails | null | undefined,
  platform: 'ios-simulator' | 'ios-device',
  launchId?: string,
): AppCrashDetails | undefined => {
  if (!details) {
    return undefined;
  }

  return {
    platform: details.platform ?? platform,
    kind: details.kind ?? 'unknown',
    confidence: details.confidence ?? 'medium',
    occurredAt: details.occurredAt ?? Date.now(),
    launchId: details.launchId ?? launchId,
    source: details.source,
    summary: details.summary,
    signal: details.signal,
    exceptionType: details.exceptionType,
    processName: details.processName,
    pid: details.pid,
    stackTrace: details.stackTrace,
    rawLines: details.rawLines,
    artifactType: details.artifactType,
    artifactPath: details.artifactPath,
  };
};

const getRecentLogBlock = ({
  recentLogLines,
  occurredAt,
}: {
  recentLogLines: TimedLogLine[];
  occurredAt: number;
}) => {
  const nearbyLines = recentLogLines.filter(
    (line) => Math.abs(line.occurredAt - occurredAt) <= 1000,
  );

  return nearbyLines.map((line) => line.line);
};

const toLogOnlyDetails = ({
  artifact,
  recentLogLines,
  occurredAt,
}: {
  artifact: AppCrashDetails;
  recentLogLines: TimedLogLine[];
  occurredAt: number;
}): AppCrashDetails => {
  const relatedLogLines = getRecentLogBlock({
    recentLogLines,
    occurredAt,
  });

  return {
    ...artifact,
    summary:
      relatedLogLines.length > 0
        ? relatedLogLines.join('\n')
        : artifact.summary,
    rawLines: relatedLogLines.length > 0 ? relatedLogLines : artifact.rawLines,
    artifactType: undefined,
    artifactPath: undefined,
  };
};

const createCrashDetailsLookup = ({
  targetId,
  targetType,
  platform,
  bundleId,
  getProcessNames,
  getMinOccurredAt,
  getCurrentLaunchId,
  crashArtifactWriter,
  base,
}: {
  targetId: string;
  targetType: 'simulator' | 'device';
  platform: 'ios-simulator' | 'ios-device';
  bundleId: string;
  getProcessNames: () => string[];
  getMinOccurredAt: () => number | undefined;
  getCurrentLaunchId: () => string | undefined;
  crashArtifactWriter?: CrashArtifactWriter;
  base: ReturnType<typeof createAppMonitorBase>;
}) => {
  return async (options: CrashDetailsLookupOptions) => {
    await new Promise((resolve) =>
      setTimeout(resolve, CRASH_ARTIFACT_SETTLE_DELAY_MS),
    );

    const artifact = await waitForCrashArtifact({
      lookup: options,
      options: {
        targetId,
        targetType,
        bundleId,
        processNames: getProcessNames(),
        crashArtifactWriter,
        minOccurredAt: getMinOccurredAt(),
      },
      getFallbackArtifact: () => base.getLatestCrashArtifact(options),
      recordArtifact: (details) => base.recordCrashArtifact(details),
    });

    if (!artifact) {
      return null;
    }

    const normalizedArtifact = normalizeCrashDetails(
      {
        ...artifact,
        kind:
          artifact.artifactType === 'ios-crash-report'
            ? 'crash-report'
            : artifact.kind,
        confidence:
          artifact.artifactType === 'ios-crash-report'
            ? 'high'
            : artifact.confidence,
      },
      platform,
      getCurrentLaunchId(),
    );

    if (!normalizedArtifact) {
      return null;
    }

    if (normalizedArtifact.artifactType === 'ios-crash-report') {
      return normalizedArtifact;
    }

    return toLogOnlyDetails({
      artifact: normalizedArtifact,
      recentLogLines: base.getRecentLogLines(),
      occurredAt: options.occurredAt,
    });
  };
};

const waitForPollInterval = async (signal: AbortSignal) => {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, PROCESS_POLL_INTERVAL_MS);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const createProcessExitDetails = ({
  platform,
  processName,
  pid,
  summary,
}: {
  platform: 'ios-simulator' | 'ios-device';
  processName: string;
  pid?: number;
  summary: string;
}): AppCrashDetails => ({
  platform,
  kind: 'process-exit',
  confidence: platform === 'ios-device' ? 'low' : 'medium',
  source: 'polling',
  processName,
  pid,
  summary,
});

type WatchReject = (error: Error) => void;

const createIosMonitorRuntime = ({
  platform,
  resolveCrashDetails,
  onReset,
}: {
  platform: 'ios-simulator' | 'ios-device';
  resolveCrashDetails: (
    options: CrashDetailsLookupOptions,
  ) => Promise<AppCrashDetails | null>;
  onReset?: () => void;
}) => {
  let alive = false;
  let monitoring = false;
  let disposed = false;
  let resolvingCrash = false;
  let crashReported = false;
  let controlledStop = false;
  let currentLaunchId: string | undefined;
  let launchCompletedAt: number | undefined;
  let currentTestFilePath = '';
  let currentPhase: AppLifecyclePhase = 'startup';
  let pendingCrash:
    | {
        at: number;
        details: AppCrashDetails;
      }
    | undefined;
  const watchers = new Set<WatchReject>();

  const setMonitoring = (nextMonitoring: boolean) => {
    monitoring = nextMonitoring;
  };

  const clearCrashState = () => {
    pendingCrash = undefined;
    resolvingCrash = false;
    crashReported = false;
  };

  const hasRecentSuspicion = () =>
    pendingCrash !== undefined &&
    Date.now() - pendingCrash.at <= SUSPICION_WINDOW_MS;

  const isLaunchRecent = () =>
    launchCompletedAt !== undefined &&
    Date.now() - launchCompletedAt <= RECENT_LAUNCH_WINDOW_MS;

  const notifyCrash = (error: NativeCrashError) => {
    const pendingWatchers = [...watchers];
    watchers.clear();

    for (const reject of pendingWatchers) {
      reject(error);
    }
  };

  const recordPendingCrash = (details?: AppCrashDetails) => {
    const normalizedDetails = normalizeCrashDetails(
      details,
      platform,
      currentLaunchId,
    );

    if (!normalizedDetails) {
      return;
    }

    pendingCrash = {
      at: Date.now(),
      details:
        mergeCrashDetails(
          hasRecentSuspicion() ? pendingCrash?.details : undefined,
          normalizedDetails,
        ) ?? normalizedDetails,
    };
  };

  const confirmCrash = async (
    details?: AppCrashDetails,
    fallbackSummary?: string,
  ) => {
    if (disposed || !monitoring || resolvingCrash || crashReported) {
      return;
    }

    resolvingCrash = true;
    alive = false;

    const initialDetails = mergeCrashDetails(
      pendingCrash?.details,
      normalizeCrashDetails(details, platform, currentLaunchId),
    );

    try {
      const enrichedDetails = await resolveCrashDetails({
        processName: initialDetails?.processName,
        pid: initialDetails?.pid,
        occurredAt: initialDetails?.occurredAt ?? Date.now(),
      });

      crashReported = true;
      pendingCrash = undefined;

      notifyCrash(
        new NativeCrashError(
          currentTestFilePath,
          mergeNativeCrashDetails({
            phase: currentPhase,
            initial: initialDetails,
            enriched: normalizeCrashDetails(
              enrichedDetails,
              platform,
              currentLaunchId,
            ),
            fallbackSummary,
          }),
        ),
      );
    } finally {
      resolvingCrash = false;
    }
  };

  const appStarted = () => {
    if (disposed || !monitoring) {
      return;
    }

    alive = true;
    controlledStop = false;
    clearCrashState();
  };

  const crashSuspected = (details?: AppCrashDetails) => {
    if (disposed || !monitoring || controlledStop) {
      return;
    }

    recordPendingCrash(details);
  };

  const processExited = (details?: AppCrashDetails) => {
    if (disposed || !monitoring || controlledStop) {
      return;
    }

    alive = false;

    const normalizedDetails = normalizeCrashDetails(
      details,
      platform,
      currentLaunchId,
    );

    if (!hasRecentSuspicion() && !isLaunchRecent()) {
      return;
    }

    recordPendingCrash(normalizedDetails);
    void confirmCrash(normalizedDetails, normalizedDetails?.summary);
  };

  const launchRequested = (event: { launchId: string }) => {
    currentLaunchId = event.launchId;
    launchCompletedAt = undefined;
    alive = false;
    controlledStop = false;
    clearCrashState();
  };

  const launchCompleted = (event: LaunchCompletedEvent) => {
    currentLaunchId = event.launchId;
    launchCompletedAt = event.at;
    alive = true;
    controlledStop = false;
  };

  const launchFailed = () => {
    alive = false;
    launchCompletedAt = undefined;
    clearCrashState();
  };

  const stopRequested = () => {
    controlledStop = true;
    alive = false;
    pendingCrash = undefined;
  };

  const stopCompleted = () => undefined;

  const watch = (testFilePath: string, phase: AppLifecyclePhase) => {
    currentTestFilePath = testFilePath;
    currentPhase = phase;

    let rejectFn!: WatchReject;

    const promise = new Promise<never>((_, reject) => {
      rejectFn = (error) => {
        watchers.delete(rejectFn);
        reject(error);
      };

      watchers.add(rejectFn);
    });

    return {
      promise,
      cancel: () => {
        rejectFn(new CrashWatchCancelledError());
      },
    };
  };

  const reset = () => {
    alive = false;
    controlledStop = false;
    currentLaunchId = undefined;
    launchCompletedAt = undefined;
    currentTestFilePath = '';
    currentPhase = 'startup';
    watchers.clear();
    clearCrashState();
    onReset?.();
  };

  const disposeState = () => {
    disposed = true;
    monitoring = false;
    alive = false;
    controlledStop = false;
    currentLaunchId = undefined;
    launchCompletedAt = undefined;
    watchers.clear();
    clearCrashState();
  };

  return {
    setMonitoring,
    disposeState,
    launchRequested,
    launchCompleted,
    launchFailed,
    stopRequested,
    stopCompleted,
    watch,
    reset,
    isAlive: () => alive,
    appStarted,
    crashSuspected,
    processExited,
    confirmCrash,
    isControlledStop: () => controlledStop,
    isLaunchRecent,
    getCurrentLaunchId: () => currentLaunchId,
    getLaunchCompletedAt: () => launchCompletedAt,
  };
};

export const createIosSimulatorAppMonitor = ({
  udid,
  bundleId,
  isAppRunning,
  crashArtifactWriter,
}: {
  udid: string;
  bundleId: string;
  isAppRunning: () => Promise<boolean>;
  crashArtifactWriter?: CrashArtifactWriter;
}): AppLifecycleMonitor => {
  const base = createAppMonitorBase();
  let logProcess: Subprocess | null = null;
  let logTask: Promise<void> | null = null;
  let pollTask: Promise<void> | null = null;
  let pollAbortController: AbortController | null = null;
  let launchSweepTimeout: ReturnType<typeof setTimeout> | null = null;
  let processNames = [bundleId];
  let monitorStartedAt = 0;

  const runtime = createIosMonitorRuntime({
    platform: 'ios-simulator',
    resolveCrashDetails: createCrashDetailsLookup({
      targetId: udid,
      targetType: 'simulator',
      platform: 'ios-simulator',
      bundleId,
      getProcessNames: () => processNames,
      getMinOccurredAt: () => runtime.getLaunchCompletedAt() ?? monitorStartedAt,
      getCurrentLaunchId: () => runtime.getCurrentLaunchId(),
      crashArtifactWriter,
      base,
    }),
    onReset: () => {
      base.reset();
    },
  });

  const clearLaunchSweep = () => {
    if (launchSweepTimeout) {
      clearTimeout(launchSweepTimeout);
      launchSweepTimeout = null;
    }
  };

  const scheduleLaunchSweep = () => {
    clearLaunchSweep();
    launchSweepTimeout = setTimeout(async () => {
      launchSweepTimeout = null;

      if (runtime.isControlledStop() || !runtime.isLaunchRecent()) {
        return;
      }

      try {
        if (await isAppRunning()) {
          runtime.appStarted();
          return;
        }

        const crashDetails = createProcessExitDetails({
          platform: 'ios-simulator',
          processName: processNames[0] ?? bundleId,
          summary: `${processNames[0] ?? bundleId} exited on simulator`,
        });

        base.recordCrashArtifact(crashDetails);
        await runtime.confirmCrash(crashDetails, crashDetails.summary);
      } catch (error) {
        iosAppMonitorLogger.debug(
          'iOS simulator post-launch crash sweep failed',
          error,
        );
      }
    }, POST_LAUNCH_CRASH_SWEEP_DELAY_MS);
  };

  return {
    start: async () => {
      runtime.setMonitoring(true);
      monitorStartedAt = Date.now();
      const appInfo = await simctl.getAppInfo(udid, bundleId);
      processNames = [
        ...new Set(
          [appInfo?.CFBundleExecutable, appInfo?.CFBundleName, bundleId].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ];

      const predicate = processNames
        .map((name) => `process == "${name}"`)
        .join(' OR ');

      logProcess = simctl.streamLogs(udid, predicate);
      const currentLogProcess = logProcess;

      if (currentLogProcess) {
        logTask = (async () => {
          try {
            for await (const line of currentLogProcess) {
              if (!isRelevantProcessLogLine(line, processNames)) {
                continue;
              }

              base.recordLogLine(line);

              const event = createUnifiedLogEvent({
                line,
                processNames,
                platform: 'ios-simulator',
              });

              if (!event) {
                continue;
              }

              base.recordCrashArtifact(event.crashDetails);
              runtime.crashSuspected(event.crashDetails);
            }
          } catch (error) {
            iosAppMonitorLogger.debug('iOS simulator log monitor stopped', error);
          }
        })();
      }

      pollAbortController = new AbortController();
      const signal = pollAbortController.signal;
      pollTask = (async () => {
        let lastKnownRunning = false;

        while (!signal.aborted) {
          try {
            const running = await isAppRunning();

            if (running) {
              clearLaunchSweep();
              runtime.appStarted();
              lastKnownRunning = true;
            } else if (lastKnownRunning) {
              const crashDetails = createProcessExitDetails({
                platform: 'ios-simulator',
                processName: processNames[0] ?? bundleId,
                summary: `${processNames[0] ?? bundleId} exited on simulator`,
              });

              base.recordCrashArtifact(crashDetails);
              runtime.processExited(crashDetails);
              lastKnownRunning = false;
            }
          } catch (error) {
            iosAppMonitorLogger.debug(
              'iOS simulator process polling failed',
              error,
            );
          }

          await waitForPollInterval(signal);
        }
      })();
    },
    stop: async () => {
      runtime.setMonitoring(false);
      clearLaunchSweep();

      pollAbortController?.abort();
      pollAbortController = null;

      const currentLogProcess = logProcess;
      const currentLogTask = logTask;
      const currentPollTask = pollTask;

      logProcess = null;
      logTask = null;
      pollTask = null;

      if (currentLogProcess) {
        try {
          (await currentLogProcess.nodeChildProcess).kill();
        } catch {
          // Ignore termination failures for background monitors.
        }
      }

      await currentLogTask;
      await currentPollTask;
    },
    dispose: async () => {
      runtime.disposeState();
      clearLaunchSweep();

      pollAbortController?.abort();
      pollAbortController = null;

      const currentLogProcess = logProcess;
      const currentLogTask = logTask;
      const currentPollTask = pollTask;

      logProcess = null;
      logTask = null;
      pollTask = null;

      if (currentLogProcess) {
        try {
          (await currentLogProcess.nodeChildProcess).kill();
        } catch {
          // Ignore termination failures for background monitors.
        }
      }

      await currentLogTask;
      await currentPollTask;
    },
    launchRequested: (event) => {
      clearLaunchSweep();
      runtime.launchRequested(event);
    },
    launchCompleted: (event) => {
      runtime.launchCompleted(event);
      scheduleLaunchSweep();
    },
    launchFailed: () => {
      clearLaunchSweep();
      runtime.launchFailed();
    },
    stopRequested: () => {
      clearLaunchSweep();
      runtime.stopRequested();
    },
    stopCompleted: () => runtime.stopCompleted(),
    watch: (testFilePath, phase) => runtime.watch(testFilePath, phase),
    reset: () => {
      clearLaunchSweep();
      runtime.reset();
    },
    isAlive: () => runtime.isAlive(),
  };
};

export const createIosDeviceAppMonitor = ({
  deviceId,
  bundleId,
  isAppRunning,
  crashArtifactWriter,
}: {
  deviceId: string;
  bundleId: string;
  isAppRunning: () => Promise<boolean>;
  crashArtifactWriter?: CrashArtifactWriter;
}): AppLifecycleMonitor => {
  const base = createAppMonitorBase();
  let pollTask: Promise<void> | null = null;
  let pollAbortController: AbortController | null = null;
  let launchSweepTimeout: ReturnType<typeof setTimeout> | null = null;
  let monitorStartedAt = 0;
  let processNames = [bundleId];
  let lastKnownPid: number | undefined;

  const runtime = createIosMonitorRuntime({
    platform: 'ios-device',
    resolveCrashDetails: createCrashDetailsLookup({
      targetId: deviceId,
      targetType: 'device',
      platform: 'ios-device',
      bundleId,
      getProcessNames: () => processNames,
      getMinOccurredAt: () => runtime.getLaunchCompletedAt() ?? monitorStartedAt,
      getCurrentLaunchId: () => runtime.getCurrentLaunchId(),
      crashArtifactWriter,
      base,
    }),
    onReset: () => {
      lastKnownPid = undefined;
      base.reset();
    },
  });

  const clearLaunchSweep = () => {
    if (launchSweepTimeout) {
      clearTimeout(launchSweepTimeout);
      launchSweepTimeout = null;
    }
  };

  const scheduleLaunchSweep = () => {
    clearLaunchSweep();
    launchSweepTimeout = setTimeout(async () => {
      launchSweepTimeout = null;

      if (runtime.isControlledStop() || !runtime.isLaunchRecent()) {
        return;
      }

      try {
        if (await isAppRunning()) {
          runtime.appStarted();
          return;
        }

        const crashDetails = createProcessExitDetails({
          platform: 'ios-device',
          processName: processNames[0] ?? bundleId,
          pid: lastKnownPid,
          summary: `${processNames[0] ?? bundleId} exited on device`,
        });

        base.recordCrashArtifact(crashDetails);
        await runtime.confirmCrash(crashDetails, crashDetails.summary);
      } catch (error) {
        iosAppMonitorLogger.debug(
          'iOS device post-launch crash sweep failed',
          error,
        );
      }
    }, POST_LAUNCH_CRASH_SWEEP_DELAY_MS);
  };

  return {
    start: async () => {
      runtime.setMonitoring(true);
      monitorStartedAt = Date.now();
      const appInfo = await devicectl.getAppInfo(deviceId, bundleId);
      processNames = [
        ...new Set(
          [appInfo?.name, bundleId].filter((value): value is string => Boolean(value)),
        ),
      ];

      pollAbortController = new AbortController();
      const signal = pollAbortController.signal;
      pollTask = (async () => {
        let wasRunning = false;

        while (!signal.aborted) {
          try {
            const processes = await devicectl.getProcesses(deviceId);
            const matchingProcess = processes.find((process) => {
              if (appInfo?.url) {
                return process.executable.startsWith(appInfo.url);
              }

              return processNames.some((processName) =>
                process.executable.includes(processName),
              );
            });

            if (matchingProcess) {
              clearLaunchSweep();
              wasRunning = true;
              lastKnownPid = matchingProcess.processIdentifier;
              runtime.appStarted();
            } else if (wasRunning) {
              const crashDetails = createProcessExitDetails({
                platform: 'ios-device',
                processName: processNames[0] ?? bundleId,
                pid: lastKnownPid,
                summary: `${processNames[0] ?? bundleId} exited on device`,
              });

              base.recordCrashArtifact(crashDetails);
              runtime.processExited(crashDetails);
              wasRunning = false;
            }
          } catch (error) {
            iosAppMonitorLogger.debug('iOS device process polling failed', error);
          }

          await waitForPollInterval(signal);
        }
      })();

      const initialArtifacts = await collectCrashArtifacts({
        targetId: deviceId,
        targetType: 'device',
        bundleId,
        processNames,
        crashArtifactWriter,
        minOccurredAt: monitorStartedAt,
      });

      for (const artifact of initialArtifacts) {
        base.recordCrashArtifact(
          normalizeCrashDetails(artifact, 'ios-device', runtime.getCurrentLaunchId()) ??
            artifact,
        );
      }
    },
    stop: async () => {
      runtime.setMonitoring(false);
      clearLaunchSweep();

      pollAbortController?.abort();
      pollAbortController = null;

      const currentPollTask = pollTask;
      pollTask = null;
      await currentPollTask;
    },
    dispose: async () => {
      runtime.disposeState();
      clearLaunchSweep();

      pollAbortController?.abort();
      pollAbortController = null;

      const currentPollTask = pollTask;
      pollTask = null;
      await currentPollTask;
    },
    launchRequested: (event) => {
      clearLaunchSweep();
      runtime.launchRequested(event);
    },
    launchCompleted: (event) => {
      runtime.launchCompleted(event);
      scheduleLaunchSweep();
    },
    launchFailed: () => {
      clearLaunchSweep();
      runtime.launchFailed();
    },
    stopRequested: () => {
      clearLaunchSweep();
      runtime.stopRequested();
    },
    stopCompleted: () => runtime.stopCompleted(),
    watch: (testFilePath, phase) => runtime.watch(testFilePath, phase),
    reset: () => {
      clearLaunchSweep();
      runtime.reset();
    },
    isAlive: () => runtime.isAlive(),
  };
};
