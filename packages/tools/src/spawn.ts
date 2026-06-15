import type { Options, Subprocess } from 'nano-spawn';
import nanoSpawn, { SubprocessError } from 'nano-spawn';
import { logger } from './logger.js';

export type SpawnOptions = Options;
export type TerminateSubprocessOptions = {
  forceAfterMs?: number;
};
export type HarnessSubprocess = Subprocess & {
  terminate: (options?: TerminateSubprocessOptions) => Promise<void>;
};

const spawnLogger = logger.child('spawn');
const activeChildProcesses = new Set<Subprocess>();
let isProcessCleanupInstalled = false;
let isTerminating = false;
const DEFAULT_FORCE_AFTER_MS = 5_000;

type CleanupSignal = 'SIGINT' | 'SIGTERM';

const SIGNAL_EXIT_CODES: Record<CleanupSignal, number> = {
  SIGINT: 130,
  SIGTERM: 143,
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForSubprocessExit = async (
  childProcess: Awaited<Subprocess['nodeChildProcess']>
): Promise<void> => {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      childProcess.off('close', finish);
      childProcess.off('error', finish);
      resolve();
    };

    childProcess.once('close', finish);
    childProcess.once('error', finish);
  });
};

const terminateNodeChildProcess = async (
  childProcess: Awaited<Subprocess['nodeChildProcess']>,
  forceAfterMs: number
): Promise<void> => {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  childProcess.kill('SIGTERM');
  await Promise.race([waitForSubprocessExit(childProcess), delay(forceAfterMs)]);

  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  childProcess.kill('SIGKILL');
  await Promise.race([waitForSubprocessExit(childProcess), delay(forceAfterMs)]);
};

const installProcessCleanup = () => {
  if (isProcessCleanupInstalled) {
    return;
  }

  isProcessCleanupInstalled = true;

  const terminate = async (signal: CleanupSignal) => {
    if (isTerminating) {
      return;
    }

    isTerminating = true;
    const shouldExitAfterCleanup = process.listenerCount(signal) <= 1;

    await Promise.allSettled(
      [...activeChildProcesses].map(async (childProcess) => {
        try {
          (await childProcess.nodeChildProcess).kill();
        } catch {
          // Ignore cleanup failures while shutting down.
        }
      })
    );

    if (shouldExitAfterCleanup) {
      process.exit(process.exitCode ?? SIGNAL_EXIT_CODES[signal]);
    }
  };

  process.on('SIGINT', () => {
    void terminate('SIGINT');
  });
  process.on('SIGTERM', () => {
    void terminate('SIGTERM');
  });
};

const setupChildProcessCleanup = (childProcess: Subprocess) => {
  // https://stackoverflow.com/questions/53049939/node-daemon-wont-start-with-process-stdin-setrawmodetrue/53050098#53050098
  if (process.stdin.isTTY) {
    // overwrite @clack/prompts setting raw mode for spinner and prompts,
    // which prevents listening for SIGINT and SIGTERM
    process.stdin.setRawMode(false);
  }

  installProcessCleanup();
  activeChildProcesses.add(childProcess);

  const cleanup = () => {
    activeChildProcesses.delete(childProcess);
  };

  childProcess.nodeChildProcess.finally(cleanup);
};

export const spawn = (
  file: string,
  args?: readonly string[],
  options?: SpawnOptions,
): HarnessSubprocess => {
  const defaultOptions: Options = {
    stdin: 'ignore',
    stdout: 'pipe',
    // Always 'pipe' stderr to handle errors properly down the line
    stderr: 'pipe',
  };
  const command = [file, ...(args ?? [])].join(' ');
  spawnLogger.debug('running command: %s', command);
  const childProcess = nanoSpawn(file, args, { ...defaultOptions, ...options });
  setupChildProcessCleanup(childProcess);

  return Object.assign(childProcess, {
    terminate: async (terminateOptions?: TerminateSubprocessOptions) => {
      let nodeChildProcess: Awaited<Subprocess['nodeChildProcess']>;

      try {
        nodeChildProcess = await childProcess.nodeChildProcess;
      } catch {
        return;
      }

      await terminateNodeChildProcess(
        nodeChildProcess,
        terminateOptions?.forceAfterMs ?? DEFAULT_FORCE_AFTER_MS
      );
    },
  });
};

export const spawnAndForget = async (
  file: string,
  args?: readonly string[],
  options?: SpawnOptions
): Promise<void> => {
  try {
    await spawn(file, args, options);
  } catch {
    // We don't care about the error here.
  }
};

export { Subprocess, SubprocessError };
