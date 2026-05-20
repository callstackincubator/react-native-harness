import {
  CrashWatchCancelledError,
  NativeCrashError,
  type AppCrashDetails,
  type AppLifecycleMonitor,
  type AppLifecyclePhase,
  type AppMonitorReporter,
  type CrashArtifactWriter,
  type CrashDetailsLookupOptions,
  type LaunchRequestedEvent,
  type NativeCrashDetails,
} from '@react-native-harness/platforms';
import {
  escapeRegExp,
  logger,
  SubprocessError,
  type Subprocess,
} from '@react-native-harness/tools';
import * as adb from './adb.js';
import { androidCrashParser } from './crash-parser.js';

const androidAppMonitorLogger = logger.child('android-app-monitor');

const getLogcatArgs = (_appUid: number, fromTime: string) =>
  [
    'logcat',
    '-b',
    'crash',
    '-b',
    'main',
    '-b',
    'system',
    '-b',
    'events',
    '-v',
    'threadtime',
    '-T',
    fromTime,
  ] as const;
const MAX_RECENT_LOG_LINES = 400;
const MAX_RECENT_CRASH_ARTIFACTS = 10;
const CRASH_ARTIFACT_SETTLE_DELAY_MS = 100;
const CRASH_CORRELATION_WINDOW_MS = 1000;
const PROCESS_POLL_INTERVAL_MS = 250;

const startProcPattern = (bundleId: string) =>
  new RegExp(`Start proc (\\d+):${escapeRegExp(bundleId)}(?:/|\\s)`);

const processPattern = (bundleId: string) =>
  new RegExp(`Process:\\s*${escapeRegExp(bundleId)},\\s*PID:\\s*(\\d+)`);

const nativeCrashPattern = (bundleId: string) =>
  new RegExp(`>>>\\s*${escapeRegExp(bundleId)}\\s*<<<`);

const processDiedPattern = (bundleId: string) =>
  new RegExp(
    `Process\\s+${escapeRegExp(bundleId)}\\s+\\(pid\\s+(\\d+)\\)\\s+has\\s+died`,
    'i',
  );

const amCrashPattern = /\bam_crash\b/i;
const amAnrPattern = /\bam_anr\b/i;
const forceFinishingPattern = /Force finishing activity/i;
const nativeAbortPattern =
  /Fatal signal\s+\d+|Abort message:|backtrace:|signal\s+11|signal\s+6/i;

const getSignal = (line: string) => {
  const namedSignalMatch = line.match(/\b(SIG[A-Z0-9]+)\b/);

  if (namedSignalMatch) {
    return namedSignalMatch[1];
  }

  const signalNumberMatch = line.match(/signal\s+(\d+)/i);

  if (signalNumberMatch) {
    return `signal ${signalNumberMatch[1]}`;
  }

  return undefined;
};

const mergeCrashDetails = (
  existing: AppCrashDetails | undefined,
  incoming: AppCrashDetails,
): AppCrashDetails => ({
  ...existing,
  ...incoming,
  platform: incoming.platform ?? existing?.platform,
  kind: incoming.kind ?? existing?.kind,
  confidence: incoming.confidence ?? existing?.confidence,
  occurredAt: incoming.occurredAt ?? existing?.occurredAt,
  launchId: incoming.launchId ?? existing?.launchId,
  source: incoming.source ?? existing?.source,
  summary: incoming.summary ?? existing?.summary,
  signal: incoming.signal ?? existing?.signal,
  exceptionType: incoming.exceptionType ?? existing?.exceptionType,
  processName: incoming.processName ?? existing?.processName,
  pid: incoming.pid ?? existing?.pid,
  stackTrace: incoming.stackTrace ?? existing?.stackTrace,
  rawLines: incoming.rawLines ?? existing?.rawLines,
  artifactType: incoming.artifactType ?? existing?.artifactType,
  artifactPath: incoming.artifactPath ?? existing?.artifactPath,
});

const mergeNativeCrashDetails = (
  phase: AppLifecyclePhase,
  initial?: AppCrashDetails,
  enriched?: AppCrashDetails | null,
  fallbackSummary?: string,
): NativeCrashDetails => ({
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

const getAndroidLogLineCrashDetails = ({
  line,
  bundleId,
  pid,
  kind,
  confidence,
}: {
  line: string;
  bundleId: string;
  pid?: number;
  kind?: AppCrashDetails['kind'];
  confidence?: AppCrashDetails['confidence'];
}): AppCrashDetails => {
  const fatalExceptionMatch = line.match(/FATAL EXCEPTION:\s*(.+)$/i);
  const processMatch = line.match(processPattern(bundleId));

  return {
    platform: 'android',
    kind,
    confidence,
    source: 'logs',
    summary: line.trim(),
    signal: getSignal(line),
    exceptionType: fatalExceptionMatch?.[1]?.trim(),
    processName: processMatch
      ? bundleId
      : line.includes(bundleId)
        ? bundleId
        : undefined,
    pid: pid ?? (processMatch ? Number(processMatch[1]) : undefined),
    rawLines: [line],
  };
};

type TimedLogLine = {
  line: string;
  occurredAt: number;
};

type AndroidCrashArtifact = AppCrashDetails & {
  occurredAt: number;
  triggerLine: string;
  triggerOccurredAt?: number;
};

type PendingCrash = {
  details: AppCrashDetails;
  occurredAt: number;
};

type AndroidMonitorSignal =
  | { type: 'app_started'; pid?: number }
  | { type: 'crash_suspected'; crashDetails: AppCrashDetails }
  | { type: 'crash_confirmed'; crashDetails: AppCrashDetails }
  | { type: 'app_exited'; crashDetails?: AppCrashDetails };

type WatchReject = (error: Error) => void;

const CRASH_BLOCK_HEADER = '--------- beginning of crash';

const getLatestCrashBlock = (recentLogLines: TimedLogLine[]) => {
  const lines = recentLogLines.map(({ line }) => line);
  let latestCrashHeaderIndex = -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/FATAL EXCEPTION:|Process:\s+.+,\s+PID:/i.test(lines[index])) {
      latestCrashHeaderIndex = index;
      break;
    }
  }

  const blockStartIndex = Math.max(
    lines.lastIndexOf(CRASH_BLOCK_HEADER),
    latestCrashHeaderIndex,
  );

  if (blockStartIndex === -1) {
    return lines;
  }

  return lines.slice(blockStartIndex);
};

const getCrashBlockForArtifact = ({
  artifact,
  recentLogLines,
}: {
  artifact: AndroidCrashArtifact;
  recentLogLines: TimedLogLine[];
}): string[] => {
  const targetIndex = recentLogLines.findIndex(
    ({ line, occurredAt }) =>
      line === artifact.triggerLine &&
      (artifact.triggerOccurredAt === undefined ||
        occurredAt === artifact.triggerOccurredAt),
  );

  if (targetIndex === -1) {
    return artifact.rawLines ?? [];
  }

  let blockStartIndex = targetIndex;

  for (let index = targetIndex; index >= 0; index -= 1) {
    if (recentLogLines[index].line === CRASH_BLOCK_HEADER) {
      blockStartIndex = index;
      break;
    }
  }

  let blockEndIndex = recentLogLines.length;

  for (let index = targetIndex + 1; index < recentLogLines.length; index += 1) {
    if (recentLogLines[index].line === CRASH_BLOCK_HEADER) {
      blockEndIndex = index;
      break;
    }
  }

  return recentLogLines
    .slice(blockStartIndex, blockEndIndex)
    .map(({ line }) => line);
};

const hydrateCrashArtifact = ({
  artifact,
  recentLogLines,
}: {
  artifact: AndroidCrashArtifact;
  recentLogLines: TimedLogLine[];
}): AppCrashDetails => {
  const rawLines = getCrashBlockForArtifact({ artifact, recentLogLines });

  if (rawLines.length === 0) {
    return artifact;
  }

  const parsedDetails = androidCrashParser.parse({
    contents: rawLines.join('\n'),
    bundleId: artifact.processName ?? '',
    pid: artifact.pid,
  });

  return {
    ...artifact,
    ...parsedDetails,
    platform: 'android',
    kind: artifact.kind,
    confidence: artifact.confidence,
    occurredAt: artifact.occurredAt,
    launchId: artifact.launchId,
    artifactType: artifact.artifactType,
    artifactPath: artifact.artifactPath,
    rawLines,
  };
};

const createCrashArtifact = ({
  details,
  recentLogLines,
}: {
  details: AppCrashDetails;
  recentLogLines: TimedLogLine[];
}): AndroidCrashArtifact => {
  const occurredAt = details.occurredAt ?? Date.now();
  const rawLines = getLatestCrashBlock(recentLogLines);
  const triggerOccurredAt = [...recentLogLines]
    .reverse()
    .find(({ line }) => line === details.summary)?.occurredAt;
  const contents =
    rawLines.length > 0
      ? rawLines.join('\n')
      : (details.rawLines ?? []).join('\n');
  const parsedDetails =
    details.processName !== undefined
      ? androidCrashParser.parse({
          contents,
          bundleId: details.processName,
          pid: details.pid,
        })
      : details;

  return {
    ...parsedDetails,
    ...details,
    platform: 'android',
    occurredAt,
    triggerLine: details.summary ?? '',
    triggerOccurredAt,
    artifactType: 'logcat',
    rawLines:
      rawLines.length > 0
        ? rawLines
        : parsedDetails.rawLines ?? details.rawLines,
  };
};

const persistCrashArtifact = ({
  details,
  crashArtifactWriter,
}: {
  details: AppCrashDetails;
  crashArtifactWriter?: CrashArtifactWriter;
}): AppCrashDetails => {
  if (!crashArtifactWriter || details.artifactType !== 'logcat') {
    return details;
  }

  const artifactBody = details.rawLines?.join('\n');

  if (!artifactBody) {
    return details;
  }

  return {
    ...details,
    artifactPath: crashArtifactWriter.persistArtifact({
      artifactKind: details.artifactType,
      source: {
        kind: 'text',
        fileName: 'logcat.txt',
        text: `${artifactBody}\n`,
      },
    }),
  };
};

const getLatestCrashArtifact = ({
  crashArtifacts,
  recentLogLines,
  processName,
  pid,
  occurredAt,
}: CrashDetailsLookupOptions & {
  crashArtifacts: AndroidCrashArtifact[];
  recentLogLines: TimedLogLine[];
}): AppCrashDetails | null => {
  const matchingByPid = pid
    ? crashArtifacts.filter((artifact) => artifact.pid === pid)
    : [];
  const matchingByProcess = processName
    ? crashArtifacts.filter((artifact) => artifact.processName === processName)
    : [];
  const candidates =
    matchingByPid.length > 0
      ? matchingByPid
      : matchingByProcess.length > 0
        ? matchingByProcess
        : crashArtifacts;
  const sortedCandidates = [...candidates].sort(
    (left, right) =>
      Math.abs(left.occurredAt - occurredAt) -
      Math.abs(right.occurredAt - occurredAt),
  );

  const artifact = sortedCandidates[0];

  if (!artifact) {
    return null;
  }

  return hydrateCrashArtifact({
    artifact,
    recentLogLines,
  });
};

const createAndroidLogEvent = (
  line: string,
  bundleId: string,
): AndroidMonitorSignal | null => {
  const startMatch = line.match(startProcPattern(bundleId));

  if (startMatch) {
    return {
      type: 'app_started',
      pid: Number(startMatch[1]),
    };
  }

  const processMatch = line.match(processPattern(bundleId));

  if (processMatch) {
    return {
      type: 'crash_suspected',
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
        pid: Number(processMatch[1]),
        kind: 'java-exception',
        confidence: 'high',
      }),
    };
  }

  if (line.includes(bundleId) && amCrashPattern.test(line)) {
    return {
      type: 'crash_confirmed',
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
        kind: 'java-exception',
        confidence: 'high',
      }),
    };
  }

  if (
    line.includes(bundleId) &&
    (amAnrPattern.test(line) || /\bANR\b/i.test(line))
  ) {
    return {
      type: 'crash_confirmed',
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
        kind: 'anr',
        confidence: 'medium',
      }),
    };
  }

  if (line.includes(bundleId) && forceFinishingPattern.test(line)) {
    return {
      type: 'crash_confirmed',
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
        kind: 'java-exception',
        confidence: 'high',
      }),
    };
  }

  if (nativeCrashPattern(bundleId).test(line)) {
    return {
      type: 'crash_suspected',
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
        kind: 'native-crash',
        confidence: 'high',
      }),
    };
  }

  const diedMatch = line.match(processDiedPattern(bundleId));

  if (diedMatch) {
    return {
      type: 'app_exited',
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
        pid: Number(diedMatch[1]),
        kind: 'process-exit',
        confidence: 'medium',
      }),
    };
  }

  if (line.includes(bundleId) && nativeAbortPattern.test(line)) {
    return {
      type: 'crash_suspected',
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
        kind: 'native-crash',
        confidence: 'high',
      }),
    };
  }

  return null;
};

const waitForPollInterval = async (signal: AbortSignal): Promise<void> => {
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
      resolve();
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
};

export const createAndroidAppMonitor = ({
  adbId,
  bundleId,
  appUid,
  isAppRunning,
  crashArtifactWriter,
  eventReporter,
}: {
  adbId: string;
  bundleId: string;
  appUid: number;
  isAppRunning: () => Promise<boolean>;
  crashArtifactWriter?: CrashArtifactWriter;
  eventReporter?: AppMonitorReporter;
}): AppLifecycleMonitor => {
  let logcatProcess: Subprocess | null = null;
  let logTask: Promise<void> | null = null;
  let pollTask: Promise<void> | null = null;
  let pollAbortController: AbortController | null = null;
  let recentLogLines: TimedLogLine[] = [];
  let recentCrashArtifacts: AndroidCrashArtifact[] = [];
  let currentLaunchId: string | undefined;
  let currentTestFilePath = '';
  let currentPhase: AppLifecyclePhase = 'startup';
  let alive = false;
  let monitoring = true;
  let disposed = false;
  let resolvingCrash = false;
  let crashReported = false;
  let controlledStop = false;
  let startedReported = false;
  let lastKnownRunning: boolean | null = null;
  let pendingCrash: PendingCrash | null = null;
  const watchers = new Set<WatchReject>();

  const reportEvent = (event: Parameters<AppMonitorReporter>[0]) => {
    try {
      eventReporter?.(event);
    } catch (error) {
      androidAppMonitorLogger.debug('Android app monitor event reporter failed', error);
    }
  };

  const createReportedDetails = (details?: AppCrashDetails) => {
    const normalizedDetails = details ? normalizeCrashDetails(details) : undefined;

    return {
      timestamp: Date.now(),
      appPlatform: 'android' as const,
      targetIdentifier: adbId,
      testFile: currentTestFilePath || undefined,
      phase: currentTestFilePath ? currentPhase : undefined,
      launchId: normalizedDetails?.launchId ?? currentLaunchId,
      processName: normalizedDetails?.processName,
      pid: normalizedDetails?.pid,
      source: normalizedDetails?.source,
      summary: normalizedDetails?.summary,
      kind: normalizedDetails?.kind,
      confidence: normalizedDetails?.confidence,
      signal: normalizedDetails?.signal,
      exceptionType: normalizedDetails?.exceptionType,
      artifactType: normalizedDetails?.artifactType,
      artifactPath: normalizedDetails?.artifactPath,
      crashDetails: normalizedDetails,
    };
  };

  const reportWarning = (warning: string, details?: AppCrashDetails) => {
    reportEvent({
      type: 'app:monitor-warning',
      ...createReportedDetails(details),
      warning,
    });
  };

  const resetTransientState = () => {
    recentLogLines = [];
    recentCrashArtifacts = [];
    pendingCrash = null;
    lastKnownRunning = null;
    alive = false;
    crashReported = false;
    resolvingCrash = false;
    controlledStop = false;
    startedReported = false;
  };

  const normalizeCrashDetails = (details: AppCrashDetails): AppCrashDetails => ({
    ...details,
    platform: details.platform ?? 'android',
    occurredAt: details.occurredAt ?? Date.now(),
    launchId: details.launchId ?? currentLaunchId,
  });

  const getActivePendingCrash = () => {
    if (!pendingCrash) {
      return null;
    }

    if (Date.now() - pendingCrash.occurredAt > CRASH_CORRELATION_WINDOW_MS) {
      pendingCrash = null;
      return null;
    }

    return pendingCrash;
  };

  const recordPendingCrash = (details: AppCrashDetails) => {
    const normalized = normalizeCrashDetails(details);
    const activePendingCrash = getActivePendingCrash();

    pendingCrash = {
      details: mergeCrashDetails(activePendingCrash?.details, normalized),
      occurredAt: activePendingCrash?.occurredAt ?? normalized.occurredAt ?? Date.now(),
    };
  };

  const recordLogLine = (line: string) => {
    recentLogLines = [...recentLogLines, { line, occurredAt: Date.now() }].slice(
      -MAX_RECENT_LOG_LINES,
    );
  };

  const recordCrashArtifact = (details?: AppCrashDetails) => {
    if (!details) {
      return;
    }

    recentCrashArtifacts = [
      ...recentCrashArtifacts,
      createCrashArtifact({ details: normalizeCrashDetails(details), recentLogLines }),
    ].slice(-MAX_RECENT_CRASH_ARTIFACTS);
  };

  const notifyCrash = (error: NativeCrashError) => {
    const pendingWatchers = [...watchers];
    watchers.clear();

    for (const reject of pendingWatchers) {
      reject(error);
    }
  };

  const stopProcess = async (child: Subprocess | null) => {
    if (!child) {
      return;
    }

    try {
      (await child.nodeChildProcess).kill();
    } catch {
      // Ignore termination failures for background monitors.
    }
  };

  const resolveCrashDetails = async (
    details?: AppCrashDetails,
    fallbackSummary?: string,
  ) => {
    await new Promise((resolve) =>
      setTimeout(resolve, CRASH_ARTIFACT_SETTLE_DELAY_MS),
    );

    const initialDetails = details ? normalizeCrashDetails(details) : undefined;
    const enriched = initialDetails
      ? getLatestCrashArtifact({
          crashArtifacts: recentCrashArtifacts,
          recentLogLines,
          processName: initialDetails.processName,
          pid: initialDetails.pid,
          occurredAt: initialDetails.occurredAt ?? Date.now(),
        })
      : null;

    const mergedDetails = mergeNativeCrashDetails(
      currentPhase,
      initialDetails,
      enriched,
      fallbackSummary,
    );

    return persistCrashArtifact({
      details: mergedDetails,
      crashArtifactWriter,
    }) as NativeCrashDetails;
  };

  const confirmCrash = async (
    details?: AppCrashDetails,
    fallbackSummary?: string,
  ) => {
    if (disposed || !monitoring || crashReported || resolvingCrash) {
      return;
    }

    resolvingCrash = true;
    alive = false;
    crashReported = true;

    const initialDetails = details ? normalizeCrashDetails(details) : pendingCrash?.details;

    reportEvent({
      type: 'app:crash-confirmed',
      ...createReportedDetails(initialDetails),
    });

    try {
      const resolvedDetails = await resolveCrashDetails(details, fallbackSummary);

      if (resolvedDetails.artifactType || resolvedDetails.artifactPath) {
        reportEvent({
          type: 'app:crash-report-ready',
          ...createReportedDetails(resolvedDetails),
          crashDetails: resolvedDetails,
        });
      }

      notifyCrash(new NativeCrashError(currentTestFilePath, resolvedDetails));
    } finally {
      resolvingCrash = false;
      pendingCrash = null;
    }
  };

  const handleAppExit = (details?: AppCrashDetails) => {
    alive = false;
    startedReported = false;

    if (details) {
      reportEvent({
        type: 'app:exited',
        ...createReportedDetails(details),
      });
    }

    if (controlledStop || disposed || !monitoring || crashReported) {
      return;
    }

    const activePendingCrash = getActivePendingCrash();

    if (!activePendingCrash) {
      return;
    }

    void confirmCrash(
      mergeCrashDetails(activePendingCrash.details, {
        ...details,
        kind: details?.kind,
        confidence: details?.confidence,
      }),
    );
  };

  const handleLogEvent = (event: AndroidMonitorSignal) => {
    if (disposed || !monitoring) {
      return;
    }

    if (event.type === 'app_started') {
      if (!startedReported) {
        reportEvent({
          type: 'app:started',
          ...createReportedDetails({
            platform: 'android',
            processName: bundleId,
            pid: event.pid,
            source: 'logs',
            summary: `Process ${bundleId} started`,
          }),
        });
        startedReported = true;
      }

      alive = true;
      controlledStop = false;
      pendingCrash = null;
      crashReported = false;
      lastKnownRunning = true;
      return;
    }

    if (event.type === 'app_exited') {
      recordCrashArtifact(event.crashDetails);
      handleAppExit(event.crashDetails);
      return;
    }

    recordCrashArtifact(event.crashDetails);

    if (event.type === 'crash_suspected') {
      reportEvent({
        type: 'app:crash-suspected',
        ...createReportedDetails(event.crashDetails),
      });
      recordPendingCrash(event.crashDetails);
      return;
    }

    recordPendingCrash(event.crashDetails);

    const activePendingCrash = getActivePendingCrash();
    void confirmCrash(activePendingCrash?.details ?? event.crashDetails);
  };

  const startPoller = () => {
    const abortController = new AbortController();
    pollAbortController = abortController;

    pollTask = (async () => {
      while (!abortController.signal.aborted) {
        try {
          const running = await isAppRunning();
          const wasRunning = lastKnownRunning;

          lastKnownRunning = running;

          if (running) {
            if (!startedReported) {
              reportEvent({
                type: 'app:started',
                ...createReportedDetails({
                  platform: 'android',
                  processName: bundleId,
                  source: 'polling',
                  summary: `Process ${bundleId} is running`,
                }),
              });
              startedReported = true;
            }

            alive = true;

            if (wasRunning === false) {
              controlledStop = false;
              pendingCrash = null;
              crashReported = false;
            }
          } else {
            handleAppExit(
              wasRunning
                ? {
                    platform: 'android',
                    kind: 'process-exit',
                    confidence: 'medium',
                    source: 'polling',
                    processName: bundleId,
                    summary: `Process ${bundleId} exited`,
                  }
                : undefined,
            );
          }
        } catch (error) {
          if (!abortController.signal.aborted) {
            androidAppMonitorLogger.debug(
              'Android process poller failed',
              error,
            );
            reportWarning('Android process poller failed');
          }
        }

        await waitForPollInterval(abortController.signal);
      }
    })();
  };

  const stopPoller = async () => {
    const abortController = pollAbortController;
    const currentTask = pollTask;

    pollAbortController = null;
    pollTask = null;

    abortController?.abort();
    await currentTask;
  };

  const startCollectors = async () => {
    const logcatTimestamp = await adb.getLogcatTimestamp(adbId);

    logcatProcess = adb.startLogcat(adbId, getLogcatArgs(appUid, logcatTimestamp));
    const currentProcess = logcatProcess;

    logTask = (async () => {
      try {
        for await (const line of currentProcess) {
          recordLogLine(line);

          const event = createAndroidLogEvent(line, bundleId);

          if (event) {
            handleLogEvent(event);
          }
        }
      } catch (error) {
        if (!(error instanceof SubprocessError && error.signalName === 'SIGTERM')) {
          androidAppMonitorLogger.debug('Android logcat monitor stopped', error);
          reportWarning('Android logcat monitor stopped unexpectedly');
        }
      }
    })();

    startPoller();
  };

  const stopCollectors = async () => {
    const currentProcess = logcatProcess;
    const currentTask = logTask;

    logcatProcess = null;
    logTask = null;

    await stopProcess(currentProcess);
    await currentTask;
    await stopPoller();
  };

  return {
    start: async () => {
      monitoring = true;
      await startCollectors();
    },
    stop: async () => {
      monitoring = false;
      await stopCollectors();
    },
    dispose: async () => {
      disposed = true;
      monitoring = false;
      alive = false;
      pendingCrash = null;
      watchers.clear();
      await stopCollectors();
    },
    launchRequested: (event: LaunchRequestedEvent) => {
      currentLaunchId = event.launchId;
      alive = false;
      controlledStop = false;
      pendingCrash = null;
      crashReported = false;
    },
    launchCompleted: () => {
      alive = true;
      controlledStop = false;
    },
    launchFailed: () => {
      alive = false;
      pendingCrash = null;
    },
    stopRequested: () => {
      controlledStop = true;
      alive = false;
      pendingCrash = null;
    },
    stopCompleted: () => undefined,
    watch: (testFilePath, phase) => {
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
    },
    reset: () => {
      currentTestFilePath = '';
      currentPhase = 'startup';
      watchers.clear();
      resetTransientState();
    },
    isAlive: () => alive,
  };
};

export { createAndroidLogEvent };
