export class HarnessAppPathError extends Error {
  constructor(reason: 'missing' | 'invalid', appPath?: string) {
    super(
      reason === 'missing'
        ? 'App is not installed on the simulator and HARNESS_APP_PATH is not set.'
        : `HARNESS_APP_PATH points to a missing app bundle: ${
            appPath ?? '<unknown>'
          }`
    );
    this.name = 'HarnessAppPathError';
  }
}
