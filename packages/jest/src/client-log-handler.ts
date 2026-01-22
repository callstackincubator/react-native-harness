import type { ReportableEvent } from '@react-native-harness/bundler-metro';
import chalk from 'chalk';
import util from 'node:util';
import { log } from './logs.js';

export type ClientLogEvent = Extract<ReportableEvent, { type: 'client_log' }>;

type LogLevel = ClientLogEvent['level'];

/**
 * Gets the display level for a log level.
 * Note: Metro treats 'trace' as 'log' because Hermes doesn't include stack traces.
 */
const getDisplayLevel = (level: LogLevel): string => {
  // Metro converts trace to log for display (Hermes doesn't provide stack traces)
  if (level === 'trace') {
    return 'LOG';
  }
  return level.toUpperCase();
};

/**
 * Creates a styled tag for a log level with colored box appearance.
 */
const createLevelTag = (level: LogLevel): string => {
  const displayLevel = getDisplayLevel(level);
  const label = ` ${displayLevel} `;

  if (!chalk.supportsColor) {
    return `[${displayLevel}]`;
  }

  switch (level) {
    case 'error':
      return chalk.reset.inverse.bold.red(label);
    case 'warn':
      return chalk.reset.inverse.bold.yellow(label);
    case 'info':
      return chalk.reset.inverse.bold.cyan(label);
    case 'debug':
      return chalk.reset.inverse.bold.blue(label);
    case 'trace':
      // Trace displays as LOG but with a distinct color
      return chalk.reset.inverse.bold.magenta(label);
    case 'log':
    default:
      return chalk.reset.inverse.bold.white(label);
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
 * Formats a client log event into a log line with styled level prefix.
 */
export const formatClientLogLine = (event: ClientLogEvent): string => {
  const tag = createLevelTag(event.level);
  const message = formatClientLogMessage(event.data);
  return `${tag} ${message}`;
};

/**
 * Handles a client_log event by formatting and logging it.
 * Returns true if the event was handled, false otherwise.
 */
export const handleClientLogEvent = (event: ReportableEvent): boolean => {
  if (event.type !== 'client_log') {
    return false;
  }

  // Skip group events - they don't produce output
  if (
    event.level === 'group' ||
    event.level === 'groupCollapsed' ||
    event.level === 'groupEnd'
  ) {
    return true;
  }

  const logLine = formatClientLogLine(event);
  log(logLine);
  return true;
};

/**
 * Creates a client log event listener that can be added to the Metro reporter.
 */
export const createClientLogListener = (): ((event: ReportableEvent) => void) => {
  return (event: ReportableEvent) => {
    handleClientLogEvent(event);
  };
};
