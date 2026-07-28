import type { Options, Subprocess } from 'nano-spawn';
import nanoSpawn, { SubprocessError } from 'nano-spawn';
import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { logger } from './logger.js';

export type SpawnOptions = Options;
const spawnLogger = logger.child('spawn');

/**
 * The subset of `Subprocess` that consumers only needing access to the
 * underlying `node:child_process` handle (e.g. to terminate it, or to wait
 * for it to exit) actually rely on. Satisfied by both nano-spawn's
 * `Subprocess` and by `StreamingSubprocess` below, so helpers that only need
 * this can accept either.
 */
export type ChildProcessHandle = {
  nodeChildProcess: Promise<ChildProcess>;
};

let signalsDeliverableEnsured = false;

/**
 * Restores default stdin raw-mode handling so SIGINT/SIGTERM keep being
 * delivered to the process. @clack/prompts puts stdin into raw mode for its
 * spinner/prompt UI, which otherwise suppresses those signals. Call this once
 * per process, before relying on signal handlers.
 */
export const ensureSignalsDeliverable = (): void => {
  if (signalsDeliverableEnsured) {
    return;
  }
  signalsDeliverableEnsured = true;

  if (process.stdin.isTTY) {
    // https://stackoverflow.com/questions/53049939/node-daemon-wont-start-with-process-stdin-setrawmodetrue/53050098#53050098
    process.stdin.setRawMode(false);
  }
};

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
  return nanoSpawn(file, args, { ...defaultOptions, ...options });
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

export type StreamingSubprocessOptions = SpawnOptionsWithoutStdio;

/**
 * A handle for a process spawned via `spawnStreaming`. Unlike `Subprocess`
 * (nano-spawn), it never buffers stdout/stderr into memory: callers that
 * need the output must consume `nodeChildProcess`'s `stdout`/`stderr`
 * streams directly (e.g. to tee them to a log file).
 *
 * Resolves when the process exits with code `0`; rejects otherwise.
 */
export type StreamingSubprocess = Promise<void> & ChildProcessHandle;

/**
 * Spawns a process without buffering its stdout/stderr in memory.
 *
 * `spawn` (nano-spawn) always accumulates output into `state.stdout`,
 * `state.stderr`, and `state.output` strings for the lifetime of the
 * process, with no cap — fine for short commands whose output is awaited,
 * but unbounded memory growth for long-lived processes (e.g. a test runner
 * that streams output for an entire session) whose output is consumed as a
 * stream instead. Use this variant for those cases.
 *
 * The caller is responsible for consuming (or ignoring) the child's
 * `stdout`/`stderr` streams via `nodeChildProcess`; otherwise the streams
 * will still hold data in their internal buffers until read, per Node's
 * usual stream backpressure rules.
 */
export const spawnStreaming = (
  file: string,
  args?: readonly string[],
  options?: StreamingSubprocessOptions
): StreamingSubprocess => {
  const command = [file, ...(args ?? [])].join(' ');
  spawnLogger.debug('running command (streaming, unbuffered): %s', command);

  const childProcess = nodeSpawn(file, args ? [...args] : [], {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const nodeChildProcess = Promise.resolve(childProcess);

  const completion = new Promise<void>((resolve, reject) => {
    childProcess.once('error', (error) => {
      reject(error);
    });
    childProcess.once('close', (code, signal) => {
      if (signal) {
        reject(
          new Error(`Command was terminated with ${signal}: ${command}`)
        );
        return;
      }

      if (code !== 0) {
        reject(
          new Error(`Command failed with exit code ${code}: ${command}`)
        );
        return;
      }

      resolve();
    });
  });

  return Object.assign(completion, { nodeChildProcess });
};

export { Subprocess, SubprocessError };
