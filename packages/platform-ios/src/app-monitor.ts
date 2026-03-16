import {
  type AppMonitor,
  type AppCrashDetails,
  type AppMonitorEvent,
  type AppMonitorListener,
  type CrashArtifactWriter,
  type CrashDetailsLookupOptions,
} from '@react-native-harness/platforms';
import { escapeRegExp, getEmitter, logger, spawn, type Subprocess } from '@react-native-harness/tools';
import * as devicectl from './xcrun/devicectl.js';
import * as simctl from './xcrun/simctl.js';
import * as libimobiledevice from './libimobiledevice.js';

const MAX_RECENT_LOG_LINES = 200;
const MAX_RECENT_CRASH_ARTIFACTS = 10;
const CRASH_ARTIFACT_SETTLE_DELAY_MS = 100;
const CRASH_ARTIFACT_WAIT_TIMEOUT_MS = 10000;
const CRASH_ARTIFACT_POLL_INTERVAL_MS = 1000;

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
    new RegExp(`\\b${escapeRegExp(processName)}\\b`).test(line)
  );

const getPid = (line: string, processNames: string[]) => {
  for (const processName of processNames) {
    const match = line.match(
      new RegExp(`\\b${escapeRegExp(processName)}(?:\\([^)]*\\))?\\[(\\d+)(?::[^\\]]+)?\\]`)
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
    new RegExp(`\\b${escapeRegExp(processName)}(?:\\[|\\b)`).test(line)
  );

const isRelevantProcessLogLine = (line: string, processNames: string[]) =>
  processNames.some((processName) =>
    new RegExp(`\\b${escapeRegExp(processName)}(?:\\([^)]*\\))?\\[`).test(line)
  );

const isCrashSignal = (line: string) =>
  /uncaught exception|terminating app due to|fatal error|EXC_[A-Z_]+|termination reason/i.test(
    line
  ) || /\bSIG[A-Z]{2,}\b/.test(line);

const getIosLogCrashDetails = ({
  line,
  processNames,
}: {
  line: string;
  processNames: string[];
}): AppCrashDetails => {
  const exceptionMatch = line.match(/exception[^:]*:\s*([^,]+)/i);

  return {
    source: 'logs',
    summary: line.trim(),
    signal: getSignal(line),
    exceptionType: exceptionMatch?.[1]?.trim(),
    processName: getProcessName(line, processNames),
    pid: getPid(line, processNames),
    rawLines: [line],
  };
};

export const createUnifiedLogEvent = ({
  line,
  processNames,
}: {
  line: string;
  processNames: string[];
}): AppMonitorEvent | null => {
  if (!isRelevantProcessLine(line, processNames)) {
    return null;
  }

  if (isCrashSignal(line)) {
    return {
      type: 'possible_crash',
      source: 'logs',
      line,
      isConfirmed: true,
      crashDetails: getIosLogCrashDetails({
        line,
        processNames,
      }),
    };
  }

  return null;
};

const createAppMonitorBase = () => {
  const emitter = getEmitter<AppMonitorEvent>();
  let isStarted = false;
  let recentLogLines: TimedLogLine[] = [];
  let recentCrashArtifacts: IosCrashArtifact[] = [];

  const emit = (event: AppMonitorEvent) => {
    emitter.emit(event);
  };

  const recordLogLine = (line: string) => {
    recentLogLines = [...recentLogLines, { line, occurredAt: Date.now() }].slice(
      -MAX_RECENT_LOG_LINES
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
    options: CrashDetailsLookupOptions
  ): AppCrashDetails | null => {
    const matchingByPid = options.pid
      ? recentCrashArtifacts.filter((artifact) => artifact.pid === options.pid)
      : [];
    const matchingByProcess = options.processName
      ? recentCrashArtifacts.filter(
        (artifact) => artifact.processName === options.processName
      )
      : [];
    const candidates =
      matchingByPid.length > 0
        ? matchingByPid
        : matchingByProcess.length > 0
          ? matchingByProcess
          : recentCrashArtifacts;
    const preferredCandidates = candidates.filter(
      (artifact) =>
        artifact.artifactType === 'ios-crash-report'
    );
    const prioritizedCandidates =
      preferredCandidates.length > 0 ? preferredCandidates : candidates;

    return (
      [...prioritizedCandidates].sort(
        (left, right) =>
          Math.abs(left.occurredAt - options.occurredAt) -
          Math.abs(right.occurredAt - options.occurredAt)
      )[0] ?? null
    );
  };

  const handleLogEvent = (line: string, processNames: string[]) => {
    if (!isRelevantProcessLogLine(line, processNames)) {
      return;
    }

    recordLogLine(line);
    emit({ type: 'log', source: 'logs', line });

    const event = createUnifiedLogEvent({
      line,
      processNames,
    });

    if (!event) {
      return;
    }

    if (
      (event.type === 'possible_crash' || event.type === 'app_exited') &&
      event.crashDetails
    ) {
      recordCrashArtifact(event.crashDetails);
    }

    emit(event);
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

  const createLifecycle = ({
    startLogMonitor,
    stopLogMonitor,
    getCrashDetails,
  }: {
    startLogMonitor: (startedAt: number) => Promise<void>;
    stopLogMonitor: () => Promise<void>;
    getCrashDetails: (
      options: CrashDetailsLookupOptions
    ) => Promise<AppCrashDetails | null>;
  }): IosAppMonitor => {
    const start = async () => {
      if (isStarted) {
        return;
      }

      const startedAt = Date.now();

      try {
        await startLogMonitor(startedAt);
        isStarted = true;
      } catch (error) {
        await stopLogMonitor();
        throw error;
      }
    };

    const stop = async () => {
      if (!isStarted) {
        return;
      }

      isStarted = false;
      await stopLogMonitor();
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
      getCrashDetails,
    };
  };

  return {
    createLifecycle,
    handleLogEvent,
    recordCrashArtifact,
    getLatestCrashArtifact,
    getRecentLogLines: () => recentLogLines,
    stopProcess,
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
    (line) => Math.abs(line.occurredAt - occurredAt) <= 1000
  );

  return nearbyLines.map((line) => line.line);
};

export const createIosSimulatorAppMonitor = ({
  udid,
  bundleId,
  crashArtifactWriter,
}: {
  udid: string;
  bundleId: string;
  crashArtifactWriter?: CrashArtifactWriter;
}): IosAppMonitor => {
  const base = createAppMonitorBase();
  let logProcess: Subprocess | null = null;
  let logTask: Promise<void> | null = null;
  let processNames = [bundleId];
  let monitorStartedAt = 0;

  const startLogMonitor = async (startedAt: number) => {
    monitorStartedAt = startedAt;
    const appInfo = await simctl.getAppInfo(udid, bundleId);
    processNames = [...new Set([
      appInfo?.CFBundleExecutable,
      appInfo?.CFBundleName,
      bundleId,
    ].filter((value): value is string => Boolean(value)))];

    const predicate = processNames
      .map((name) => `process == "${name}"`)
      .join(' OR ');

    logProcess = spawn(
      'xcrun',
      [
        'simctl',
        'spawn',
        udid,
        'log',
        'stream',
        '--style',
        'compact',
        '--level',
        'info',
        '--predicate',
        predicate,
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );

    const currentProcess = logProcess;

    if (!currentProcess) {
      return;
    }

    logTask = (async () => {
      try {
        for await (const line of currentProcess) {
          base.handleLogEvent(line, processNames);
        }
      } catch (error) {
        logger.debug('iOS simulator log monitor stopped', error);
      }
    })();
  };

  const stopLogMonitor = async () => {
    const currentProcess = logProcess;
    const currentTask = logTask;

    logProcess = null;
    logTask = null;

    await base.stopProcess(currentProcess);
    await currentTask;
  };

  const waitForCrashArtifact = async (
    options: CrashDetailsLookupOptions
  ): Promise<AppCrashDetails | null> => {
    let fallbackArtifact: AppCrashDetails | null = null;
    const deadline = Date.now() + CRASH_ARTIFACT_WAIT_TIMEOUT_MS;
    let pollCount = 0;

    do {
      pollCount += 1;
      logger.debug(`[app-monitor] waitForCrashArtifact poll #${pollCount}`, { pid: options.pid, processName: options.processName });

      const collectedArtifacts = await simctl.collectCrashReports({
        udid,
        bundleId,
        processNames,
        crashArtifactWriter,
        minOccurredAt: monitorStartedAt,
      });

      logger.debug(`[app-monitor] poll #${pollCount}: collected ${collectedArtifacts.length} crash artifact(s) from DiagnosticReports`);

      for (const artifact of collectedArtifacts) {
        base.recordCrashArtifact(artifact);
      }

      const artifact = base.getLatestCrashArtifact(options);

      if (artifact) {
        logger.debug(`[app-monitor] poll #${pollCount}: found artifact`, { artifactType: artifact.artifactType, artifactPath: artifact.artifactPath, pid: artifact.pid, processName: artifact.processName });

        if (artifact.artifactType === 'ios-crash-report') {
          return artifact;
        }

        fallbackArtifact = artifact;
      } else {
        logger.debug(`[app-monitor] poll #${pollCount}: no matching artifact yet`);
      }

      if (Date.now() >= deadline) {
        logger.debug(`[app-monitor] waitForCrashArtifact deadline reached, returning ${fallbackArtifact ? 'fallback log-based artifact' : 'null'}`);
        return fallbackArtifact;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, CRASH_ARTIFACT_POLL_INTERVAL_MS)
      );
      // eslint-disable-next-line no-constant-condition
    } while (true);
  };

  return base.createLifecycle({
    startLogMonitor,
    stopLogMonitor,
    getCrashDetails: async (options) => {
      logger.debug('[app-monitor] getCrashDetails called (simulator)', { pid: options.pid, processName: options.processName });
      await new Promise((resolve) =>
        setTimeout(resolve, CRASH_ARTIFACT_SETTLE_DELAY_MS)
      );

      const artifact = await waitForCrashArtifact(options);

      if (!artifact) {
        logger.debug('[app-monitor] getCrashDetails: no artifact found, returning null');
        return null;
      }

      if (artifact.artifactType === 'ios-crash-report') {
        logger.debug('[app-monitor] getCrashDetails: returning ios-crash-report artifact', { artifactPath: artifact.artifactPath });
        return artifact;
      }

      const relatedLogLines = getRecentLogBlock({
        recentLogLines: base.getRecentLogLines(),
        occurredAt: options.occurredAt,
      });

      logger.debug(`[app-monitor] getCrashDetails: returning log-based artifact (${relatedLogLines.length} related log lines)`);

      return {
        ...artifact,
        summary:
          relatedLogLines.length > 0
            ? relatedLogLines.join('\n')
            : artifact.summary,
        rawLines:
          relatedLogLines.length > 0 ? relatedLogLines : artifact.rawLines,
        artifactType: undefined,
        artifactPath: undefined,
      };
    },
  });
};

export const createIosDeviceAppMonitor = ({
  deviceId,
  libimobiledeviceUdid,
  bundleId,
  crashArtifactWriter,
}: {
  deviceId: string;
  libimobiledeviceUdid: string;
  bundleId: string;
  crashArtifactWriter?: CrashArtifactWriter;
}): IosAppMonitor => {
  const base = createAppMonitorBase();
  let logProcess: Subprocess | null = null;
  let logTask: Promise<void> | null = null;
  let processNames = [bundleId];
  let monitorStartedAt = 0;

  const startLogMonitor = async (startedAt: number) => {
    monitorStartedAt = startedAt;
    const appInfo = await devicectl.getAppInfo(deviceId, bundleId);
    processNames = [bundleId, appInfo?.name].filter(
      (value): value is string => Boolean(value)
    );

    await libimobiledevice.assertLibimobiledeviceTargetAvailable(libimobiledeviceUdid);
    logProcess = libimobiledevice.createSyslogProcess({
      targetId: libimobiledeviceUdid,
      processNames,
    });

    const currentProcess = logProcess;

    if (!currentProcess) {
      return;
    }

    logTask = (async () => {
      try {
        for await (const line of currentProcess) {
          base.handleLogEvent(line, processNames);
        }
      } catch (error) {
        logger.debug('iOS libimobiledevice log monitor stopped', error);
      }
    })();
  };

  const stopLogMonitor = async () => {
    const currentProcess = logProcess;
    const currentTask = logTask;

    logProcess = null;
    logTask = null;

    await base.stopProcess(currentProcess);
    await currentTask;
  };

  const waitForCrashArtifact = async (
    options: CrashDetailsLookupOptions
  ): Promise<AppCrashDetails | null> => {
    let fallbackArtifact: AppCrashDetails | null = null;
    const deadline = Date.now() + CRASH_ARTIFACT_WAIT_TIMEOUT_MS;

    do {
      const collectedArtifacts = await libimobiledevice.collectCrashReports({
        targetId: libimobiledeviceUdid,
        bundleId,
        processNames,
        crashArtifactWriter,
        minOccurredAt: monitorStartedAt,
      });

      for (const artifact of collectedArtifacts) {
        base.recordCrashArtifact(artifact);
      }

      const artifact = base.getLatestCrashArtifact(options);

      if (artifact) {
        if (artifact.artifactType === 'ios-crash-report') {
          return artifact;
        }

        fallbackArtifact = artifact;
      }

      if (Date.now() >= deadline) {
        return fallbackArtifact;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, CRASH_ARTIFACT_POLL_INTERVAL_MS)
      );
      // eslint-disable-next-line no-constant-condition
    } while (true);
  };

  return base.createLifecycle({
    startLogMonitor,
    stopLogMonitor,
    getCrashDetails: async (options) => {
      await new Promise((resolve) =>
        setTimeout(resolve, CRASH_ARTIFACT_SETTLE_DELAY_MS)
      );

      return waitForCrashArtifact(options);
    },
  });
};

export type IosAppMonitor = AppMonitor & {
  getCrashDetails: (
    options: CrashDetailsLookupOptions
  ) => Promise<AppCrashDetails | null>;
};
