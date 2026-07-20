import type { Subprocess } from 'nano-spawn';

// Cancellable so the winning race branch can clear the timer instead of
// leaving a ref'd setTimeout alive for `forceAfterMs` after the process
// already exited gracefully.
const delay = (ms: number): { promise: Promise<void>; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
};

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

  try {
    childProcess.kill('SIGTERM');
  } catch {
    // Ignore termination failures for already-ended processes.
  }

  const timedOut = Symbol('timedOut');
  const forceKill = delay(forceAfterMs);
  const result = await Promise.race([
    exited.then(() => 'exited' as const),
    forceKill.promise.then(() => timedOut),
  ]);
  forceKill.cancel();

  if (result === timedOut) {
    try {
      childProcess.kill('SIGKILL');
    } catch {
      // Ignore termination failures for already-ended processes.
    }
    await exited;
  }
};
