export class DevicectlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevicectlError';
  }
}

export class DeviceNotFoundError extends DevicectlError {
  constructor(deviceId: string) {
    super(
      `iOS device "${deviceId}" not found. ` +
      `Run "xcrun devicectl list devices" to see available devices.`
    );
    this.name = 'DeviceNotFoundError';
  }
}

export class DeviceHostnameLookupError extends DevicectlError {
  constructor(deviceId: string, details?: string) {
    const detailsMessage = details ? ` (${details})` : '';
    super(
      `Failed to determine network hostname for iOS device "${deviceId}"${detailsMessage}. ` +
      `Verify the device is connected and can communicate over the network. ` +
      `Run "xcrun devicectl device info details --device ${deviceId}" to diagnose.`
    );
    this.name = 'DeviceHostnameLookupError';
  }
}

export class DeviceAppNotFoundError extends DevicectlError {
  constructor(bundleId: string, deviceId: string) {
    super(
      `App "${bundleId}" not found on iOS device "${deviceId}". ` +
      `Install the app before running tests.`
    );
    this.name = 'DeviceAppNotFoundError';
  }
}
