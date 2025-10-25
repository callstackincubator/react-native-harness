type TestRunnerConfig = any;

export class NoRunnerSpecifiedError extends Error {
  constructor(availableRunners: TestRunnerConfig[]) {
    super('No runner specified');
    this.name = 'NoRunnerSpecifiedError';
    this.availableRunners = availableRunners;
  }
  availableRunners: TestRunnerConfig[];
}

export class RunnerNotFoundError extends Error {
  constructor(runnerName: string, availableRunners: TestRunnerConfig[]) {
    super(`Runner "${runnerName}" not found`);
    this.name = 'RunnerNotFoundError';
    this.runnerName = runnerName;
    this.availableRunners = availableRunners;
  }
  runnerName: string;
  availableRunners: TestRunnerConfig[];
}

export class EnvironmentInitializationError extends Error {
  constructor(
    message: string,
    runnerName: string,
    platform: string,
    details?: string
  ) {
    super(
      `Failed to initialize environment for "${runnerName}" (${platform}): ${message}`
    );
    this.name = 'EnvironmentInitializationError';
    this.runnerName = runnerName;
    this.platform = platform;
    this.details = details;
  }
  runnerName: string;
  platform: string;
  details?: string;
}

export class TestExecutionError extends Error {
  constructor(
    testFile: string,
    error: unknown,
    testSuite?: string,
    testName?: string
  ) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const suiteInfo = testSuite ? ` in suite "${testSuite}"` : '';
    const testInfo = testName ? ` test "${testName}"` : '';

    super(
      `Test execution failed for ${testFile}${suiteInfo}${testInfo}: ${errorMessage}`
    );
    this.name = 'TestExecutionError';
    this.testFile = testFile;
    this.testSuite = testSuite;
    this.testName = testName;
    this.originalError = error;
  }
  testFile: string;
  testSuite?: string;
  testName?: string;
  originalError: unknown;
}

export class RpcClientError extends Error {
  constructor(message: string, bridgePort?: number, connectionStatus?: string) {
    const portInfo = bridgePort ? ` (port ${bridgePort})` : '';
    const statusInfo = connectionStatus ? ` - Status: ${connectionStatus}` : '';

    super(`RPC client error${portInfo}: ${message}${statusInfo}`);
    this.name = 'RpcClientError';
    this.bridgePort = bridgePort;
    this.connectionStatus = connectionStatus;
  }
  bridgePort?: number;
  connectionStatus?: string;
}

export class BridgeTimeoutError extends Error {
  constructor(
    public readonly timeout: number,
    public readonly runnerName: string,
    public readonly platform: string
  ) {
    super(
      `Bridge connection timed out after ${timeout}ms while waiting for "${runnerName}" (${platform}) runner to be ready`
    );
    this.name = 'BridgeTimeoutError';
  }
}

export class BundlingFailedError extends Error {
  constructor(
    public readonly modulePath: string,
    public readonly reason: string
  ) {
    super(`Bundling of ${modulePath} failed: ${reason}`);
    this.name = 'BundlingFailedError';
  }
}

export class MetroPortUnavailableError extends Error {
  constructor(public readonly port: number) {
    super(`Metro port ${port} is not available`);
    this.name = 'MetroPortUnavailableError';
  }
}
