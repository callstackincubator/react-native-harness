import fs from 'node:fs';
import type { AppCrashDetails } from '@react-native-harness/platforms';

type ParseIosCrashReportOptions = {
  path: string;
  contents: string;
};

export type ParsedIosCrashReport = AppCrashDetails & {
  occurredAt: number;
};

const getSignal = (contents: string) => {
  const namedSignalMatch = contents.match(/\b(SIG[A-Z0-9]+)\b/);

  if (namedSignalMatch) {
    return namedSignalMatch[1];
  }

  const exceptionTypeMatch = contents.match(/\b(EXC_[A-Z_]+)\b/);

  if (exceptionTypeMatch) {
    return exceptionTypeMatch[1];
  }

  return undefined;
};

const getOccurredAt = ({
  path,
  contents,
}: ParseIosCrashReportOptions) => {
  const dateTimeMatch = contents.match(/^Date\/Time:\s+(.+)$/m);

  if (dateTimeMatch) {
    const normalizedValue = dateTimeMatch[1]
      .trim()
      .replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
      .replace(/\s+([+-]\d{2})(\d{2})$/, '$1:$2');
    const parsedDate = Date.parse(normalizedValue);

    if (!Number.isNaN(parsedDate)) {
      return parsedDate;
    }
  }

  return fs.statSync(path).mtimeMs;
};

const getCrashThreadFrames = (rawLines: string[], threadId: string) => {
  const threadHeader = `Thread ${threadId} Crashed:`;
  const threadHeaderIndex = rawLines.findIndex((line) => line.trim() === threadHeader);

  if (threadHeaderIndex === -1) {
    return undefined;
  }

  const frames: string[] = [];

  for (const line of rawLines.slice(threadHeaderIndex + 1)) {
    if (line.trim().length === 0) {
      if (frames.length > 0) {
        break;
      }

      continue;
    }

    if (!/^\d+\s+/.test(line.trim())) {
      if (frames.length > 0) {
        break;
      }

      continue;
    }

    frames.push(line.trim());
  }

  return frames.length > 0 ? frames : undefined;
};

const parseCrashTextReport = ({
  path,
  contents,
}: ParseIosCrashReportOptions): ParsedIosCrashReport => {
  const rawLines = contents.split(/\r?\n/);
  const processMatch = contents.match(/^Process:\s+(.+?)\s+\[(\d+)\]$/m);
  const exceptionMatch = contents.match(/^Exception Type:\s+(.+)$/m);
  const triggeredThreadMatch = contents.match(/^Triggered by Thread:\s+(\d+)$/m);

  return {
    occurredAt: getOccurredAt({ path, contents }),
    rawLines,
    processName: processMatch?.[1]?.trim(),
    pid: processMatch ? Number(processMatch[2]) : undefined,
    signal: getSignal(contents),
    exceptionType: exceptionMatch?.[1]?.trim(),
    stackTrace: triggeredThreadMatch
      ? getCrashThreadFrames(rawLines, triggeredThreadMatch[1])
      : undefined,
  };
};

const parseIpsCrashReport = ({
  path,
  contents,
}: ParseIosCrashReportOptions): ParsedIosCrashReport | null => {
  const [headerLine, ...bodyLines] = contents.split(/\r?\n/);

  if (!headerLine || bodyLines.length === 0) {
    return null;
  }

  try {
    const header = JSON.parse(headerLine) as {
      app_name?: string;
      bundleID?: string;
      name?: string;
    };
    const body = JSON.parse(bodyLines.join('\n')) as {
      pid?: number;
      procName?: string;
      faultingThread?: number;
      threads?: Array<{
        frames?: Array<{
          imageIndex?: number;
          imageOffset?: number;
          symbol?: string;
          symbolLocation?: number;
          sourceFile?: string;
          sourceLine?: number;
        }>;
      }>;
      usedImages?: Array<{
        name?: string;
      }>;
      exception?: {
        type?: string;
        signal?: string;
      };
      termination?: {
        indicator?: string;
      };
    };
    const stackFrames =
      body.faultingThread !== undefined
        ? body.threads?.[body.faultingThread]?.frames ?? []
        : [];
    const stackTrace = stackFrames
      .map((frame, index) => {
        const imageName =
          frame.imageIndex !== undefined
            ? body.usedImages?.[frame.imageIndex]?.name
            : undefined;
        const location =
          frame.sourceFile && frame.sourceLine
            ? `${frame.sourceFile}:${frame.sourceLine}`
            : frame.symbolLocation !== undefined
              ? `+ ${frame.symbolLocation}`
              : frame.imageOffset !== undefined
                ? `+ ${frame.imageOffset}`
                : undefined;
        const symbol = frame.symbol ?? imageName ?? '<unknown>';

        return `${index} ${symbol}${location ? ` (${location})` : ''}`;
      })
      .filter((line) => line.trim().length > 0);

    return {
      occurredAt: fs.statSync(path).mtimeMs,
      rawLines: contents.split(/\r?\n/),
      processName: body.procName ?? header.app_name ?? header.name,
      pid: body.pid,
      signal: body.exception?.signal ?? getSignal(contents),
      exceptionType:
        body.exception?.type ?? body.termination?.indicator ?? getSignal(contents),
      stackTrace: stackTrace.length > 0 ? stackTrace : undefined,
    };
  } catch {
    return null;
  }
};

export const iosCrashParser = {
  parse(options: ParseIosCrashReportOptions): ParsedIosCrashReport | null {
    if (options.path.endsWith('.ips')) {
      return parseIpsCrashReport(options);
    }

    return parseCrashTextReport(options);
  },
};
