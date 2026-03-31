export class HarnessAppPathError extends Error {
  constructor(reason: 'missing' | 'invalid', appPath?: string) {
    super(
      reason === 'missing'
        ? 'App is not installed on the emulator and HARNESS_APP_PATH is not set.'
        : `HARNESS_APP_PATH points to a missing APK: ${appPath ?? '<unknown>'}`
    );
    this.name = 'HarnessAppPathError';
  }
}

export class HarnessEmulatorConfigError extends Error {
  constructor(deviceName: string) {
    super(
      `Android emulator "${deviceName}" is not running and no AVD config was provided. Add the "avd" property to this runner config so Harness can create and boot the emulator.`
    );
    this.name = 'HarnessEmulatorConfigError';
  }
}
