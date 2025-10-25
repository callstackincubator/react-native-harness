export class AppNotInstalledError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly deviceName: string
  ) {
    super(`App "${bundleId}" is not installed on ${deviceName}`);
    this.name = 'AppNotInstalledError';
  }
}

export class DeviceNotFoundError extends Error {
  constructor(public readonly deviceName: string) {
    super(`Device "${deviceName}" not found`);
    this.name = 'DeviceNotFoundError';
  }
}
