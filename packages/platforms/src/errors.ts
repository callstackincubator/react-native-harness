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

import type { AppCrashDetails, AppLifecyclePhase } from './types.js';

export type NativeCrashDetails = AppCrashDetails & {
  phase: AppLifecyclePhase;
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

export class NativeCrashError extends Error {
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
