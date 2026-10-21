import type { Options, Subprocess } from 'nano-spawn';
import nanoSpawn, { SubprocessError } from 'nano-spawn';
import { logger } from './logger.js';

export type SpawnOptions = Options;

export type ProcessManager = {
  spawn(
    file: string,
    args?: readonly string[],
    options?: SpawnOptions
  ): Subprocess;
};

const spawnLogger = logger.child('spawn');

// Characters that `cmd.exe` treats specially, plus whitespace that would split
// an argument. Arguments without them are passed to batch files unquoted,
// because batch scripts commonly test `"%1"`, which breaks when %1 is already
// quoted (e.g. `--sdk_root=C:\Sdk`).
const CMD_SPECIAL_CHARACTERS = /[\s"&|<>^()%!]/;

const quoteCmdArgument = (argument: string): string =>
  argument !== '' && !CMD_SPECIAL_CHARACTERS.test(argument)
    ? argument
    : `"${argument.replaceAll('"', '""')}"`;

/**
 * nano-spawn escapes `.bat`/`.cmd` arguments for npm-style shims, which
 * `cmd.exe` then unescapes only once, so plain batch files (like Android's
 * `sdkmanager.bat`) receive mangled arguments
 * (https://github.com/sindresorhus/nano-spawn/pull/117). Run them through
 * `cmd.exe` ourselves with a single level of quoting instead.
 */
export const getWindowsBatchInvocation = (
  file: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform
): { file: string; args: string[]; windowsVerbatimArguments: true } | null => {
  if (platform !== 'win32' || !/\.(bat|cmd)$/i.test(file)) {
    return null;
  }
  const commandLine = [file, ...args].map(quoteCmdArgument).join(' ');
  return {
    file: 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
};

const nodeSpawn = (
  file: string,
  args?: readonly string[],
  options?: SpawnOptions
): Subprocess => {
  const defaultOptions: Options = {
    stdin: 'ignore',
    stdout: 'pipe',
    // Always 'pipe' stderr to handle errors properly down the line
    stderr: 'pipe',
  };
  const command = [file, ...(args ?? [])].join(' ');
  spawnLogger.debug('running command: %s', command);
  const batchInvocation = getWindowsBatchInvocation(file, args ?? []);
  const subprocess = batchInvocation
    ? nanoSpawn(batchInvocation.file, batchInvocation.args, {
        ...defaultOptions,
        ...options,
        windowsVerbatimArguments: batchInvocation.windowsVerbatimArguments,
      })
    : nanoSpawn(file, args, { ...defaultOptions, ...options });
  // Registered before any caller can observe the subprocess, so the error is
  // enriched in place before `await`, `.catch` or iteration see it.
  subprocess.then(undefined, appendOutputToErrorMessage);
  return subprocess;
};

const OUTPUT_TAIL_MAX_LINES = 20;
const OUTPUT_TAIL_MAX_CHARS = 2000;
const enrichedErrors = new WeakSet<SubprocessError>();

const getOutputTail = (output: string | undefined): string => {
  const lines = (output ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const tail = lines.slice(-OUTPUT_TAIL_MAX_LINES).join('\n');
  return tail.length > OUTPUT_TAIL_MAX_CHARS
    ? tail.slice(-OUTPUT_TAIL_MAX_CHARS)
    : tail;
};

/**
 * nano-spawn's error message only names the command; the reason it failed is
 * usually in what the command printed. Append the tail of the captured output
 * so the message is useful wherever it ends up being reported.
 */
const appendOutputToErrorMessage = (error: unknown): void => {
  if (!(error instanceof SubprocessError) || enrichedErrors.has(error)) {
    return;
  }
  enrichedErrors.add(error);

  const sections = [
    ['stderr', getOutputTail(error.stderr)],
    ['stdout', getOutputTail(error.stdout)],
  ]
    .filter(([, tail]) => tail !== '')
    .map(([name, tail]) => `${name}:\n${tail}`);

  if (sections.length === 0) {
    return;
  }

  const originalMessage = error.message;
  error.message = `${originalMessage}\n${sections.join('\n')}`;
  // `stack` repeats the message captured at construction; printed errors use it.
  if (error.stack?.includes(originalMessage)) {
    error.stack = error.stack.replace(originalMessage, () => error.message);
  }
};

/** The real, nano-spawn-backed process manager used outside of tests. */
export const createNodeProcessManager = (): ProcessManager => ({
  spawn: nodeSpawn,
});

export { SubprocessError };
