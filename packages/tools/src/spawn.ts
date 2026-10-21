import type { Result, Subprocess } from 'nano-spawn';
import { getProcessManager } from './harness-context.js';
import {
  getWindowsBatchInvocation,
  SubprocessError,
  type SpawnOptions,
} from './process-manager.js';
export type RunCommandOptions = Omit<
  SpawnOptions,
  'signal' | 'timeout' | 'killSignal'
> & {
  signal: AbortSignal;
  timeoutMs: number;
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

/**
 * Runs a command through the current Harness context's process manager.
 *
 * Call sites should prefer `getProcessManager().spawn`; this standalone export
 * will be removed in a follow-up.
 */
export const spawn = (
  file: string,
  args?: readonly string[],
  options?: SpawnOptions
): Subprocess => getProcessManager().spawn(file, args, options);

/**
 * Runs a command with the two bounds every finite Harness command needs.
 * Keep this separate from `spawn`: streams and other owned processes have a
 * different lifecycle and must be disposed by their domain owner.
 */
export const runCommand = (
  file: string,
  args: readonly string[],
  { signal, timeoutMs, ...options }: RunCommandOptions
): Promise<Result> =>
  spawn(file, args, {
    ...options,
    signal,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });

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

export { getWindowsBatchInvocation, Subprocess, SubprocessError };
export type { SpawnOptions };
