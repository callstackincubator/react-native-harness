import type { Options, Subprocess } from 'nano-spawn';
import nanoSpawn, { SubprocessError } from 'nano-spawn';
import { logger } from './logger.js';

export type SpawnOptions = Options;
const spawnLogger = logger.child('spawn');

export const spawn = (
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
  const childProcess = nanoSpawn(file, args, { ...defaultOptions, ...options });

  setupChildProcessCleanup(childProcess);
  return childProcess;
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

const activeChildProcesses = new Set<Subprocess>();
let isProcessCleanupInstalled = false;

const terminateActiveChildren = async () => {
  const children = [...activeChildProcesses];

  await Promise.allSettled(
    children.map(async (childProcess) => {
      try {
        (await childProcess.nodeChildProcess).kill();
      } catch {
        // Ignore cleanup failures while shutting down.
      }
    })
  );
};

const installProcessCleanup = () => {
  if (isProcessCleanupInstalled) {
    return;
  }

  isProcessCleanupInstalled = true;

  const terminate = async () => {
    await terminateActiveChildren();
    process.exit(1);
  };

  process.on('SIGINT', () => {
    void terminate();
  });
  process.on('SIGTERM', () => {
    void terminate();
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
