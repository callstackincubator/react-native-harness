import {
  createManagedAppLifecycleMonitor,
  type AppCrashDetails,
  type AppLifecycleMonitor,
  type CrashArtifactWriter,
  type CrashDetailsLookupOptions,
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
const APP_EXIT_POLL_INTERVAL_MS = 1000;

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
    new RegExp(`\\b${escapeRegExp(processName)}(?:\\([^)]*\\))?\\[`).test(line),
  );

const isCrashSignal = (line: string) =>
  /uncaught exception|terminating app due to|fatal error|EXC_[A-Z_]+|termination reason/i.test(
    line,
  ) || /\bSIG[A-Z]{2,}\b/.test(line);

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
    source: 'logs',
    summary: line.trim(),
    signal: getSignal(line),
    exceptionType: exceptionMatch?.[1]?.trim(),
    processName: getProcessName(line, processNames),
    pid: getPid(line, processNames),
    rawLines: [line],
  };
};

type IosMonitorSignal =
  | { type: 'possible_crash'; confirmed?: boolean; crashDetails?: AppCrashDetails }
  | { type: 'app_exited'; confirmed?: boolean; crashDetails?: AppCrashDetails };

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

  if (isCrashSignal(line)) {
    return {
      type: 'possible_crash',
      confirmed: true,
      crashDetails: getIosLogCrashDetails({
        line,
        processNames,
        platform,
      }),
    };
  }

  return null;
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
        occurredAt: Date.now(),
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
  bundleId,
  processNames,
  monitorStartedAt,
  crashArtifactWriter,
  base,
}: {
  targetId: string;
  targetType: 'simulator' | 'device';
  bundleId: string;
  processNames: string[];
  monitorStartedAt: number;
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
        processNames,
        crashArtifactWriter,
        minOccurredAt: monitorStartedAt,
      },
      getFallbackArtifact: () => base.getLatestCrashArtifact(options),
      recordArtifact: (details) => base.recordCrashArtifact(details),
    });

    if (!artifact) {
      return null;
    }

    if (artifact.artifactType === 'ios-crash-report') {
      return artifact;
    }

    return toLogOnlyDetails({
      artifact,
      recentLogLines: base.getRecentLogLines(),
      occurredAt: options.occurredAt,
    });
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
  let processNames = [bundleId];
  let monitorStartedAt = 0;

  const managed = createManagedAppLifecycleMonitor({
    startCollectors: async () => {
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

      const currentProcess = logProcess;

      if (!currentProcess) {
        return;
      }

      logTask = (async () => {
        try {
          for await (const line of currentProcess) {
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

            if (event.crashDetails) {
              base.recordCrashArtifact(event.crashDetails);
            }

            managed.possibleCrash({
              confirmed: event.confirmed,
              details: event.crashDetails,
            });
          }
        } catch (error) {
          iosAppMonitorLogger.debug('iOS simulator log monitor stopped', error);
        }
      })();
    },
    stopCollectors: async () => {
      const currentProcess = logProcess;
      const currentTask = logTask;

      logProcess = null;
      logTask = null;

      if (currentProcess) {
        try {
          (await currentProcess.nodeChildProcess).kill();
        } catch {
          // Ignore termination failures for background monitors.
        }
      }

      await currentTask;
    },
    isAppRunning,
    resolveCrashDetails: (options) =>
      createCrashDetailsLookup({
        targetId: udid,
        targetType: 'simulator',
        bundleId,
        processNames,
        monitorStartedAt,
        crashArtifactWriter,
        base,
      })(options),
    onReset: () => {
      base.reset();
    },
  });

  return managed.monitor;
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
  let stopPolling = false;
  let monitorStartedAt = 0;
  let processNames = [bundleId];
  let lastKnownPid: number | undefined;

  const managed = createManagedAppLifecycleMonitor({
    startCollectors: async () => {
      monitorStartedAt = Date.now();
      const appInfo = await devicectl.getAppInfo(deviceId, bundleId);
      processNames = [
        ...new Set(
          [appInfo?.name, bundleId].filter((value): value is string => Boolean(value)),
        ),
      ];

      stopPolling = false;
      pollTask = (async () => {
        let wasRunning = false;

        while (!stopPolling) {
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
              wasRunning = true;
              lastKnownPid = matchingProcess.processIdentifier;
              managed.appStarted();
            } else if (wasRunning) {
              const crashDetails: AppCrashDetails = {
                platform: 'ios-device',
                source: 'polling',
                processName: processNames[0],
                pid: lastKnownPid,
                summary: `${processNames[0] ?? bundleId} exited on device`,
              };

              base.recordCrashArtifact(crashDetails);
              managed.appExited({
                confirmed: true,
                details: crashDetails,
              });
              wasRunning = false;
            }
          } catch (error) {
            iosAppMonitorLogger.debug('iOS device process polling failed', error);
          }

          await new Promise((resolve) =>
            setTimeout(resolve, APP_EXIT_POLL_INTERVAL_MS),
          );
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
        base.recordCrashArtifact(artifact);
      }
    },
    stopCollectors: async () => {
      stopPolling = true;
      await pollTask;
      pollTask = null;
    },
    isAppRunning,
    resolveCrashDetails: (options) =>
      createCrashDetailsLookup({
        targetId: deviceId,
        targetType: 'device',
        bundleId,
        processNames,
        monitorStartedAt,
        crashArtifactWriter,
        base,
      })(options),
    onReset: () => {
      lastKnownPid = undefined;
      base.reset();
    },
  });

  return managed.monitor;
};
