import type { AppCrashDetails } from '@react-native-harness/platforms';
import { escapeRegExp } from '@react-native-harness/tools';

type ParseAndroidCrashReportOptions = {
  contents: string;
  bundleId: string;
  pid?: number;
};

const getSignal = (contents: string) => {
  const namedSignalMatch = contents.match(/\b(SIG[A-Z0-9]+)\b/);

  if (namedSignalMatch) {
    return namedSignalMatch[1];
  }

  const signalNumberMatch = contents.match(/signal\s+(\d+)/i);

  if (signalNumberMatch) {
    return `signal ${signalNumberMatch[1]}`;
  }

  return undefined;
};

const getStackTrace = (rawLines: string[]) => {
  const frames = rawLines.filter((line) =>
    /^\S.*(?:\s+at\s+|\s+#\d+\s+pc\s+)/.test(line.trim()) ||
    /^\S.*AndroidRuntime:\s+at\s+/.test(line.trim()) ||
    /^\S.*AndroidRuntime:\s+Caused by:/.test(line.trim())
  );

  return frames.length > 0 ? frames : undefined;
};

export const androidCrashParser = {
  parse({
    contents,
    bundleId,
    pid,
  }: ParseAndroidCrashReportOptions): AppCrashDetails {
    const rawLines = contents.split(/\r?\n/);
    const processPattern = new RegExp(
      `Process:\\s*${escapeRegExp(bundleId)},\\s*PID:\\s*(\\d+)`
    );
    const fatalExceptionMatch = contents.match(/FATAL EXCEPTION:\s*(.+)$/im);
    const processMatch = contents.match(processPattern);
    const runtimeExceptionLine = rawLines.find((line) =>
      /AndroidRuntime: (?:java\.|kotlin\.|[\w$.]+(?:Exception|Error):)/.test(line)
    );
    const exceptionType =
      fatalExceptionMatch?.[1]?.trim() ??
      runtimeExceptionLine?.match(/AndroidRuntime:\s+(.+)$/)?.[1]?.trim();

    return {
      source: 'logs',
      summary: contents.trim(),
      signal: getSignal(contents),
      exceptionType,
      processName: processMatch ? bundleId : contents.includes(bundleId) ? bundleId : undefined,
      pid: pid ?? (processMatch ? Number(processMatch[1]) : undefined),
      rawLines,
      stackTrace: getStackTrace(rawLines),
    };
  },
};
