import type { ReportableEvent } from '@react-native-harness/bundler-metro';
import type { TestResult as JestTestResult } from '@jest/test-result';
import util from 'node:util';

export type ClientLogEvent = Extract<ReportableEvent, { type: 'client_log' }>;
export type ClientLogBuffer = NonNullable<JestTestResult['console']>;
export type ClientLogEntry = ClientLogBuffer[number];
export type ClientLogCollector = {
  handleEvent: (event: ReportableEvent) => void;
  flush: () => ClientLogBuffer;
};

type LogLevel = ClientLogEvent['level'];
type JestLogLevel = ClientLogEntry['type'];

/**
 * Gets the Jest console level for a client log level.
 * Note: Metro treats 'trace' as 'log' because Hermes doesn't include stack traces.
 */
const getJestLogLevel = (level: LogLevel): JestLogLevel | null => {
  switch (level) {
    case 'group':
    case 'groupCollapsed':
    case 'groupEnd':
      return null;
    case 'trace':
      return 'log';
    case 'log':
    default:
      return level;
  }
};

/**
 * Formats a client log event data array into a string message.
 * Uses util.format for printf-style format specifier support (%s, %d, %j, etc.)
 */
export const formatClientLogMessage = (data: unknown[]): string => {
  if (data.length === 0) {
    return '';
  }

  return util.format(...data);
};

/**
 * Formats a client log event into Jest's buffered console entry format.
 */
export const formatClientLogEntry = (
  event: ClientLogEvent
): ClientLogEntry | null => {
  const logLevel = getJestLogLevel(event.level);
  if (!logLevel) {
    return null;
  }

  const message = formatClientLogMessage(event.data);
  return {
    message,
    origin: '',
    type: logLevel,
  };
};

export const createClientLogCollector = (): ClientLogCollector => {
  let buffer: ClientLogBuffer = [];

  return {
    handleEvent: (event) => {
      if (event.type !== 'client_log') {
        return;
      }

      const entry = formatClientLogEntry(event);
      if (entry) {
        buffer.push(entry);
      }
    },
    flush: () => {
      const flushed = buffer;
      buffer = [];
      return flushed;
    },
  };
};
