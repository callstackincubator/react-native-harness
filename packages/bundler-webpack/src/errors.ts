import { HarnessError } from '@react-native-harness/tools';

export class UnsupportedPlatformError extends HarnessError {
  constructor(
    public readonly bundlerName: string,
    public readonly platformId: string
  ) {
    super(
      `The ${bundlerName} bundler runs web tests only, but the selected runner uses the "${platformId}" platform. ` +
        'Select a web runner, or remove the "bundler" option to use Metro.'
    );
    this.name = 'UnsupportedPlatformError';
  }
}

export class WatchModeUnsupportedError extends HarnessError {
  constructor(public readonly bundlerName: string) {
    super(
      `Watch mode is not supported with the ${bundlerName} bundler yet. Run the tests without --watch or --watchAll.`
    );
    this.name = 'WatchModeUnsupportedError';
  }
}

export class CompilerNotFoundError extends HarnessError {
  constructor(
    public readonly packageName: string,
    public readonly projectRoot: string
  ) {
    super(
      `"${packageName}" was not found from ${projectRoot}. Install it in your project: the bundler runs the version your app is built with.`
    );
    this.name = 'CompilerNotFoundError';
  }
}

export class InvalidConfigError extends HarnessError {
  constructor(
    public readonly configPath: string,
    reason: string
  ) {
    super(`Cannot use ${configPath}: ${reason}`);
    this.name = 'InvalidConfigError';
  }
}

export class ConfigLoadError extends HarnessError {
  constructor(
    public readonly configPath: string,
    public readonly failure: unknown
  ) {
    super(
      `Failed to load ${configPath}: ${failure instanceof Error ? failure.message : String(failure)}`
    );
    this.name = 'ConfigLoadError';
  }
}

export class ServerStartError extends HarnessError {
  constructor(
    public readonly port: number,
    public readonly failure: unknown
  ) {
    super(
      `The bundler server could not listen on port ${port}: ${failure instanceof Error ? failure.message : String(failure)}`
    );
    this.name = 'ServerStartError';
  }
}
