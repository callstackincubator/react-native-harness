import {
  getDeviceCoreBudget,
  logger,
  spawn,
  SubprocessError,
} from '@react-native-harness/tools';
import os from 'node:os';
import { getEmulatorBinaryPath } from './environment.js';

const emulatorStartupLogger = logger.child('android-emulator-startup');

export type EmulatorBootMode =
  | 'default-boot'
  | 'clean-snapshot-generation'
  | 'snapshot-reuse';

/**
 * Returns the vCPU count baked into an AVD for this runner.
 *
 * AVD snapshots require an identical hardware configuration to load, so all
 * AVD creation, compatibility, and cache-key callers must use this value on
 * the same host.
 */
export const getEmulatorCpuCores = (): number => {
  return getDeviceCoreBudget(os.availableParallelism());
};

const COMMON_EMULATOR_ARGS = [
  '-no-window',
  '-gpu',
  'swiftshader_indirect',
  '-noaudio',
  '-no-boot-anim',
  '-no-metrics',
] as const;

export const getEmulatorStartupArgs = (
  name: string,
  mode: EmulatorBootMode
): string[] => {
  const modeArgs =
    mode === 'clean-snapshot-generation'
      ? ['-no-snapshot-load']
      : mode === 'snapshot-reuse'
      ? ['-no-snapshot-save']
      : ['-no-snapshot-load', '-no-snapshot-save'];

  return [`@${name}`, ...modeArgs, ...COMMON_EMULATOR_ARGS];
};

/**
 * Parses the output of `emulator -accel-check` to determine whether
 * hardware acceleration (KVM on Linux, HVF on macOS) is usable. The
 * emulator prints a message containing "is installed and usable" when
 * acceleration is available.
 */
export const isAccelerationUsable = (accelCheckOutput: string): boolean => {
  return accelCheckOutput.includes('is installed and usable');
};

/**
 * Runs `emulator -accel-check` and logs a non-fatal warning when hardware
 * acceleration (KVM/HVF) appears unavailable, in which case the emulator
 * falls back to very slow software emulation. This check must never fail or
 * block emulator startup - any error running it is swallowed and only
 * debug-logged.
 */
export const warnIfEmulatorAccelerationUnavailable =
  async (): Promise<void> => {
    let combinedOutput: string;

    try {
      const emulatorBinaryPath = getEmulatorBinaryPath();
      const { stdout, stderr } = await spawn(emulatorBinaryPath, [
        '-accel-check',
      ]);
      combinedOutput = `${stdout}\n${stderr}`;
    } catch (error) {
      if (error instanceof SubprocessError) {
        // The check itself ran but exited non-zero - this is how
        // `-accel-check` reports that acceleration is unavailable, so treat
        // its output as a normal (non-fatal) result rather than swallowing it.
        combinedOutput = `${error.stdout}\n${error.stderr}`;
      } else {
        // Failed to even run the check (e.g. binary missing). This must never
        // fail or block emulator startup.
        emulatorStartupLogger.debug(
          'Failed to run "emulator -accel-check": %o',
          error
        );
        return;
      }
    }

    if (!isAccelerationUsable(combinedOutput)) {
      logger.warn(
        'Hardware acceleration (KVM/HVF) appears unavailable for the Android emulator. It will fall back to very slow software emulation.'
      );
    }
  };
