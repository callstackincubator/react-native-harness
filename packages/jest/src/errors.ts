import { formatPath, HarnessError } from '@react-native-harness/tools';
import type { AppCrashDetails } from '@react-native-harness/platforms';
export {
  StartupStallError,
  type StartupStallCode,
  type StartupStallDetails,
} from '@react-native-harness/bundler-metro';

export class NoRunnerSpecifiedError extends HarnessError {
  constructor() {
    super('No runner specified');
    this.name = 'NoRunnerSpecifiedError';
  }
}

export class RunnerNotFoundError extends HarnessError {
  constructor(public readonly runnerName: string) {
    super(`Runner "${runnerName}" not found`);
    this.name = 'RunnerNotFoundError';
  }
}

export class InitializationTimeoutError extends HarnessError {
  constructor() {
    super('The Harness did not become ready within the timeout period.');
    this.name = 'InitializationTimeoutError';
  }
}

export class PlatformReadyTimeoutError extends HarnessError {
  constructor(public readonly timeout: number) {
    super(
      `The platform did not become ready within ${timeout}ms. Increase "platformReadyTimeout" if your device, simulator, or emulator needs more time to start.`
    );
    this.name = 'PlatformReadyTimeoutError';
  }
}

export class MetroPortRangeExhaustedError extends HarnessError {
  constructor(
    public readonly initialPort: number,
    public readonly attempts: number
  ) {
    const finalPort = initialPort + attempts - 1;
    super(
      `Harness could not find an available Metro port in the range ${initialPort}-${finalPort}.`
    );
    this.name = 'MetroPortRangeExhaustedError';
  }
}

export type NativeCrashPhase = 'startup' | 'execution';

export type NativeCrashDetails = AppCrashDetails & {
  phase: NativeCrashPhase;
};

export type RuntimeDisconnectDetails = AppCrashDetails & {
  phase: NativeCrashPhase;
};

const buildNativeCrashMessage = ({
  phase,
  summary,
  signal,
  exceptionType,
  processName,
  pid,
  stackTrace,
  artifactType,
  artifactPath,
  enrichmentArtifacts,
}: NativeCrashDetails) => {
  const lines = [
    phase === 'startup'
      ? 'The native app crashed while preparing to run this test file.'
      : 'The native app crashed during test execution.',
  ];

  lines.push(
    artifactPath
      ? `Harness extracted the crash log: ${formatPath(artifactPath)}`
      : "Harness couldn't extract the crash log."
  );

  if (enrichmentArtifacts && enrichmentArtifacts.length > 0) {
    lines.push('Additional crash artifacts:');
    for (const artifact of enrichmentArtifacts) {
      lines.push(`  - ${formatPath(artifact.artifactPath)}`);
    }
  }

  const hasCrashBlock = summary?.includes('\n') ?? false;
  const shouldRenderSummary =
    Boolean(summary) &&
    !(!hasCrashBlock && artifactType === 'ios-crash-report');

  if (shouldRenderSummary && summary) {
    lines.push('');
    lines.push(summary);
  }

  if (!hasCrashBlock && signal) {
    lines.push(`Signal: ${signal}`);
  }

  if (!hasCrashBlock && exceptionType) {
    lines.push(`Exception: ${exceptionType}`);
  }

  if (!hasCrashBlock && processName && pid !== undefined) {
    lines.push(`Process: ${processName} (pid ${pid})`);
  } else if (!hasCrashBlock && processName) {
    lines.push(`Process: ${processName}`);
  } else if (!hasCrashBlock && pid !== undefined) {
    lines.push(`PID: ${pid}`);
  }

  if (!hasCrashBlock && stackTrace && stackTrace.length > 0) {
    lines.push('');
    lines.push(...stackTrace.map((line) => `  ${line}`));
  }

  return lines.join('\n');
};

export class NativeCrashError extends HarnessError {
  constructor(
    public readonly testFilePath: string,
    public readonly details: NativeCrashDetails,
    public readonly lastKnownTest?: string
  ) {
    super(buildNativeCrashMessage(details));
    this.name = 'NativeCrashError';
    this.stack = `${this.name}: ${this.message.split('\n')[0]}`;
  }

  get phase() {
    return this.details.phase;
  }
}

const buildRuntimeDisconnectMessage = ({
  phase,
  summary,
  rawLines,
}: RuntimeDisconnectDetails) => {
  const lines = [
    phase === 'startup'
      ? 'The native runtime disconnected while preparing to run this test file.'
      : 'The native runtime disconnected during test execution.',
  ];

  if (summary) {
    lines.push('');
    lines.push(summary);
  }

  if (rawLines && rawLines.length > 0 && summary !== rawLines.join('\n')) {
    lines.push('');
    lines.push(...rawLines);
  }

  return lines.join('\n');
};

export class RuntimeDisconnectError extends HarnessError {
  constructor(
    public readonly testFilePath: string,
    public readonly details: RuntimeDisconnectDetails
  ) {
    super(buildRuntimeDisconnectMessage(details));
    this.name = 'RuntimeDisconnectError';
    this.stack = `${this.name}: ${this.message.split('\n')[0]}`;
  }

  get phase() {
    return this.details.phase;
  }
}

export type HarnessRuntimeFailure = NativeCrashError | RuntimeDisconnectError;
