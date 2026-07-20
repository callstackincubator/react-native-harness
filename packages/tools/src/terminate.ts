import type { Subprocess } from 'nano-spawn';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const waitForExit = (
  childProcess: Awaited<Subprocess['nodeChildProcess']>
): Promise<void> => {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      childProcess.off('close', finish);
      childProcess.off('error', finish);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    childProcess.once('close', finish);
    childProcess.once('error', finish);
  });
};

export type TerminateOptions = {
  /** How long to wait after SIGTERM before escalating to SIGKILL. */
  forceAfterMs: number;
};

/**
 * Terminates a subprocess gracefully: sends SIGTERM, waits up to
 * `forceAfterMs` for it to exit, and escalates to SIGKILL if it hasn't.
 * Resolves once the process has exited either way.
 */
export const terminate = async (
  subprocess: Subprocess,
  { forceAfterMs }: TerminateOptions
): Promise<void> => {
  let childProcess: Awaited<Subprocess['nodeChildProcess']>;
  try {
    childProcess = await subprocess.nodeChildProcess;
  } catch {
    return;
  }

  const exited = waitForExit(childProcess);

  childProcess.kill('SIGTERM');

  const timedOut = Symbol('timedOut');
  const result = await Promise.race([
    exited.then(() => 'exited' as const),
    delay(forceAfterMs).then(() => timedOut),
  ]);

  if (result === timedOut) {
    childProcess.kill('SIGKILL');
    await exited;
  }
};
