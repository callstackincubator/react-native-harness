import type { Subprocess } from 'nano-spawn';
import { spawn, type SpawnOptions } from './spawn.js';
import { terminate } from './terminate.js';

export type OwnedProcess = {
  subprocess: Subprocess;
  dispose: () => Promise<void>;
};

export type OwnedProcessOptions = Omit<
  SpawnOptions,
  'signal' | 'killSignal' | 'timeout'
>;

const OWNED_PROCESS_FORCE_AFTER_MS = 1_000;

/** Starts a process whose lifetime is explicitly owned by its caller. */
export const spawnOwnedProcess = (
  file: string,
  args: readonly string[],
  options?: OwnedProcessOptions
): OwnedProcess => {
  const subprocess = spawn(file, args, {
    ...options,
  });
  // The caller still receives the original subprocess. This observer only
  // prevents expected cancellation from being an unhandled rejection.
  void subprocess.catch(() => undefined);
  let disposePromise: Promise<void> | undefined;

  const dispose = () =>
    (disposePromise ??= (async () => {
      await terminate(subprocess, { forceAfterMs: OWNED_PROCESS_FORCE_AFTER_MS });
    })());

  return { subprocess, dispose };
};
