import util from 'node:util';

let verbose = !!process.env.HARNESS_DEBUG;

type LoggerLevel = 'debug' | 'info' | 'warn' | 'error' | 'log' | 'success';
type LoggerMethod = (...messages: Array<unknown>) => void;

export type HarnessLogger = {
  debug: LoggerMethod;
  info: LoggerMethod;
  warn: LoggerMethod;
  error: LoggerMethod;
  log: LoggerMethod;
  success: LoggerMethod;
  child: (scope: string) => HarnessLogger;
  setVerbose: (level: boolean) => void;
  isVerbose: () => boolean;
};

const BASE_TAG = '[harness]';

const getTimestamp = (): string => new Date().toISOString();

const normalizeScope = (scope: string): string =>
  scope
    .trim()
    .replace(/^\[+|\]+$/g, '')
    .replace(/\]\[/g, '][');

const formatPrefix = (scopes: readonly string[]): string => {
  const suffix = scopes.map((scope) => `[${normalizeScope(scope)}]`).join('');
  return `${BASE_TAG}${suffix}`;
};

const mapLines = (text: string, prefix: string) =>
  text
    .split('\n')
    .map((line) => `${prefix} ${line}`)
    .join('\n');

const writeLog = (
  level: LoggerLevel,
  scopes: readonly string[],
  messages: Array<unknown>
) => {
  const method =
    level === 'warn'
      ? console.warn
      : level === 'error'
        ? console.error
        : level === 'debug'
          ? console.debug
          : console.info;
  const output = util.format(...messages);
  const prefix = `${getTimestamp()} ${formatPrefix(scopes)}`;
  method(mapLines(output, prefix));
};

const setVerbose = (level: boolean) => {
  verbose = level;
};

const isVerbose = () => {
  return verbose;
};

const createScopedLogger = (scopes: readonly string[] = []): HarnessLogger => ({
  debug: (...messages) => {
    if (!verbose) {
      return;
    }

    writeLog('debug', scopes, messages);
  },
  info: (...messages) => {
    writeLog('info', scopes, messages);
  },
  warn: (...messages) => {
    writeLog('warn', scopes, messages);
  },
  error: (...messages) => {
    writeLog('error', scopes, messages);
  },
  log: (...messages) => {
    writeLog('log', scopes, messages);
  },
  success: (...messages) => {
    writeLog('success', scopes, messages);
  },
  child: (scope) => createScopedLogger([...scopes, scope]),
  setVerbose,
  isVerbose,
});

export const createLogger = (scope: string): HarnessLogger =>
  createScopedLogger([scope]);

export const logger = createScopedLogger();
