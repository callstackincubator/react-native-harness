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

export class DependencyNotFoundError extends Error {
  constructor(
    public readonly dependencyName: string,
    public readonly installInstructions?: string
  ) {
    super(
      `Dependency "${dependencyName}" not found.${
        installInstructions ? ` ${installInstructions}` : ''
      }`
    );
    this.name = 'DependencyNotFoundError';
  }
}