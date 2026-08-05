import type { Subprocess } from 'nano-spawn';
import { spawn, type SpawnOptions } from './spawn.js';

export type OwnedProcess = {
  subprocess: Subprocess;
  dispose: () => Promise<void>;
};

export type OwnedProcessOptions = Omit<
  SpawnOptions,
  'signal' | 'killSignal' | 'timeout'
>;

const waitForChildProcessExit = (
  childProcess: Awaited<Subprocess['nodeChildProcess']>
): Promise<void> => {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      childProcess.off('close', finish);
      childProcess.off('error', finish);
      resolve();
    };
    childProcess.once('close', finish);
    childProcess.once('error', finish);
  });
};

/** Starts a process whose lifetime is explicitly owned by its caller. */
export const spawnOwnedProcess = (
  file: string,
  args: readonly string[],
  options?: OwnedProcessOptions
): OwnedProcess => {
  const controller = new AbortController();
  const subprocess = spawn(file, args, {
    ...options,
    signal: controller.signal,
    killSignal: 'SIGKILL',
  });
  // The caller still receives the original subprocess. This observer only
  // prevents expected cancellation from being an unhandled rejection.
  const settled = subprocess.catch(() => undefined);
  let disposePromise: Promise<void> | undefined;

  const dispose = () =>
    (disposePromise ??= (async () => {
      let childProcess: Awaited<Subprocess['nodeChildProcess']>;
      try {
        childProcess = await subprocess.nodeChildProcess;
      } catch {
        await settled;
        return;
      }

      const exited = waitForChildProcessExit(childProcess);
      controller.abort();
      await Promise.all([exited, settled]);
    })());

  return { subprocess, dispose };
};
