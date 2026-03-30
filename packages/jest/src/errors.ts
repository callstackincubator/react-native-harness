import { HarnessError } from '@react-native-harness/tools';
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

export type NativeCrashPhase = 'startup' | 'execution';

export type NativeCrashDetails = AppCrashDetails & {
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
}: NativeCrashDetails) => {
  const lines = [
    phase === 'startup'
      ? 'The native app crashed while preparing to run this test file.'
      : 'The native app crashed during test execution.',
  ];
  const hasCrashBlock = summary?.includes('\n') ?? false;
  const shouldRenderSummary =
    Boolean(summary) &&
    !(
      !hasCrashBlock &&
      artifactType === 'ios-crash-report'
    );

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
