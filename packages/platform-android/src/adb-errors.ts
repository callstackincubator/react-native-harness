export class AdbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdbError';
  }
}

export class AdbDeviceNotFoundError extends AdbError {
  constructor(adbId: string) {
    super(
      `Android device "${adbId}" not found or not connected. ` +
      `Run "adb devices" to see available devices.`
    );
    this.name = 'AdbDeviceNotFoundError';
  }
}

export class AdbAppNotInstalledError extends AdbError {
  constructor(bundleId: string, adbId: string) {
    super(
      `App "${bundleId}" is not installed on device "${adbId}". ` +
      `Install the app before running tests.`
    );
    this.name = 'AdbAppNotInstalledError';
  }
}

export class AdbPermissionGrantError extends AdbError {
  constructor(bundleId: string, permissions: string[], adbId: string) {
    const permissionList = permissions.join(', ');
    super(
      `Failed to grant permissions [${permissionList}] to "${bundleId}" on device "${adbId}". ` +
      `Verify the app is installed and the device supports these permissions.`
    );
    this.name = 'AdbPermissionGrantError';
  }
}

export class AdbBinaryNotFoundError extends AdbError {
  constructor() {
    super(
      `adb binary not found or not accessible. ` +
      `Ensure Android SDK is properly installed and ANDROID_HOME is set.`
    );
    this.name = 'AdbBinaryNotFoundError';
  }
}
