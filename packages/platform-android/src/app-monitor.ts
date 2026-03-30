import {
  type AppMonitor,
  type AppCrashDetails,
  type CrashArtifactWriter,
  type CrashDetailsLookupOptions,
  type AppMonitorEvent,
  type AppMonitorListener,
} from '@react-native-harness/platforms';
import { escapeRegExp, getEmitter, logger, spawn, SubprocessError, type Subprocess } from '@react-native-harness/tools';
import * as adb from './adb.js';
import { androidCrashParser } from './crash-parser.js';

const androidAppMonitorLogger = logger.child('android-app-monitor');

const getLogcatArgs = (uid: number, fromTime: string) =>
  ['logcat', '-v', 'threadtime', '-b', 'crash', `--uid=${uid}`, '-T', fromTime] as const;
const MAX_RECENT_LOG_LINES = 200;
const MAX_RECENT_CRASH_ARTIFACTS = 10;
const CRASH_ARTIFACT_SETTLE_DELAY_MS = 100;

const startProcPattern = (bundleId: string) =>
  new RegExp(`Start proc (\\d+):${escapeRegExp(bundleId)}(?:/|\\s)`);

const processPattern = (bundleId: string) =>
  new RegExp(`Process:\\s*${escapeRegExp(bundleId)},\\s*PID:\\s*(\\d+)`);

const nativeCrashPattern = (bundleId: string) =>
  new RegExp(`>>>\\s*${escapeRegExp(bundleId)}\\s*<<<`);

const processDiedPattern = (bundleId: string) =>
  new RegExp(
    `Process\\s+${escapeRegExp(bundleId)}\\s+\\(pid\\s+(\\d+)\\)\\s+has\\s+died`,
    'i'
  );

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

const getAndroidLogLineCrashDetails = ({
  line,
  bundleId,
  pid,
}: {
  line: string;
  bundleId: string;
  pid?: number;
}): AppCrashDetails => {
  const fatalExceptionMatch = line.match(/FATAL EXCEPTION:\s*(.+)$/i);
  const processMatch = line.match(processPattern(bundleId));

  return {
    source: 'logs',
    summary: line.trim(),
    signal: getSignal(line),
    exceptionType: fatalExceptionMatch?.[1]?.trim(),
    processName: processMatch ? bundleId : line.includes(bundleId) ? bundleId : undefined,
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
    latestCrashHeaderIndex
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
        occurredAt === artifact.triggerOccurredAt)
  );

  if (targetIndex === -1) {
    return artifact.rawLines ?? [];
  }

  let blockStartIndex = targetIndex;

  for (let index = targetIndex; index >= 0; index -= 1) {
    const { line } = recentLogLines[index];

    if (line === CRASH_BLOCK_HEADER) {
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
  const occurredAt = Date.now();
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
    occurredAt,
    triggerLine: details.summary ?? '',
    triggerOccurredAt,
    artifactType: 'logcat',
    rawLines:
      rawLines.length > 0 ? rawLines : parsedDetails.rawLines ?? details.rawLines,
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
      Math.abs(left.occurredAt - occurredAt) - Math.abs(right.occurredAt - occurredAt)
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
  bundleId: string
): AppMonitorEvent | null => {
  const startMatch = line.match(startProcPattern(bundleId));

  if (startMatch) {
    return {
      type: 'app_started',
      pid: Number(startMatch[1]),
      source: 'logs',
      line,
    };
  }

  const processMatch = line.match(processPattern(bundleId));

  if (processMatch) {
    return {
      type: 'possible_crash',
      pid: Number(processMatch[1]),
      source: 'logs',
      line,
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
        pid: Number(processMatch[1]),
      }),
    };
  }

  if (nativeCrashPattern(bundleId).test(line)) {
    return {
      type: 'possible_crash',
      source: 'logs',
      line,
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
      }),
    };
  }

  const diedMatch = line.match(processDiedPattern(bundleId));

  if (diedMatch) {
    return {
      type: 'app_exited',
      pid: Number(diedMatch[1]),
      source: 'logs',
      line,
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
        pid: Number(diedMatch[1]),
      }),
    };
  }

  if (
    line.includes(bundleId) &&
    /fatal|crash|signal 11|signal 6|backtrace/i.test(line)
  ) {
    return {
      type: 'possible_crash',
      source: 'logs',
      line,
      crashDetails: getAndroidLogLineCrashDetails({
        line,
        bundleId,
      }),
    };
  }

  return null;
};

export const createAndroidAppMonitor = ({
  adbId,
  bundleId,
  appUid,
  crashArtifactWriter,
}: {
  adbId: string;
  bundleId: string;
  appUid: number;
  crashArtifactWriter?: CrashArtifactWriter;
}): AndroidAppMonitor => {
  const emitter = getEmitter<AppMonitorEvent>();

  let isStarted = false;
  let logcatProcess: Subprocess | null = null;
  let logTask: Promise<void> | null = null;
  let recentLogLines: TimedLogLine[] = [];
  let recentCrashArtifacts: AndroidCrashArtifact[] = [];

  const emit = (event: AppMonitorEvent) => {
    emitter.emit(event);
  };

  const recordLogLine = (line: string) => {
    recentLogLines = [...recentLogLines, { line, occurredAt: Date.now() }].slice(
      -MAX_RECENT_LOG_LINES
    );
  };

  const recordCrashArtifact = (details?: AppCrashDetails) => {
    if (!details) {
      return;
    }

    recentCrashArtifacts = [
      ...recentCrashArtifacts,
      createCrashArtifact({
        details,
        recentLogLines,
      }),
    ].slice(-MAX_RECENT_CRASH_ARTIFACTS);
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

  const startLogcat = async () => {
    const logcatTimestamp = await adb.getLogcatTimestamp(adbId);

    logcatProcess = spawn('adb', ['-s', adbId, ...getLogcatArgs(appUid, logcatTimestamp)], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const currentProcess = logcatProcess;

    if (!currentProcess) {
      return;
    }

    logTask = (async () => {
      try {
        for await (const line of currentProcess) {
          recordLogLine(line);
          emit({ type: 'log', source: 'logs', line });

          const event = createAndroidLogEvent(line, bundleId);

          if (event) {
            if (event.type === 'possible_crash' || event.type === 'app_exited') {
              recordCrashArtifact(event.crashDetails);
            }
            emit(event);
          }
        }
      } catch (error) {
        if (!(error instanceof SubprocessError && error.signalName === 'SIGTERM')) {
          androidAppMonitorLogger.debug('Android logcat monitor stopped', error);
        }
      }
    })();
  };

  const start = async () => {
    if (isStarted) {
      return;
    }

    try {
      await startLogcat();
      isStarted = true;
    } catch (error) {
      const currentProcess = logcatProcess;
      const currentTask = logTask;

      logcatProcess = null;
      logTask = null;

      await stopProcess(currentProcess);
      await currentTask;

      throw error;
    }
  };

  const stop = async () => {
    if (!isStarted) {
      return;
    }

    isStarted = false;

    const currentProcess = logcatProcess;
    const currentTask = logTask;

    logcatProcess = null;
    logTask = null;

    await stopProcess(currentProcess);
    await currentTask;
  };

  const dispose = async () => {
    await stop();
    emitter.clearAllListeners();
    recentLogLines = [];
    recentCrashArtifacts = [];
  };

  const addListener = (listener: AppMonitorListener) => {
    emitter.addListener(listener);
  };

  const removeListener = (listener: AppMonitorListener) => {
    emitter.removeListener(listener);
  };

  return {
    start,
    stop,
    dispose,
    addListener,
    removeListener,
    getCrashDetails: async (options: CrashDetailsLookupOptions) => {
      await new Promise((resolve) =>
        setTimeout(resolve, CRASH_ARTIFACT_SETTLE_DELAY_MS)
      );

      const details = getLatestCrashArtifact({
        crashArtifacts: recentCrashArtifacts,
        recentLogLines,
        ...options,
      });

      if (!details) {
        return null;
      }

      return persistCrashArtifact({
        details,
        crashArtifactWriter,
      });
    },
  } satisfies AndroidAppMonitor;
};

export { createAndroidLogEvent };
export type AndroidAppMonitor = AppMonitor & {
  getCrashDetails: (
    options: CrashDetailsLookupOptions
  ) => Promise<AppCrashDetails | null>;
};
