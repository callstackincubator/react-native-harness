export type EmulatorBootMode =
  | 'default-boot'
  | 'clean-snapshot-generation'
  | 'snapshot-reuse';

const COMMON_EMULATOR_ARGS = [
  '-no-window',
  '-gpu',
  'swiftshader_indirect',
  '-noaudio',
  '-no-boot-anim',
  '-camera-back',
  'none',
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
