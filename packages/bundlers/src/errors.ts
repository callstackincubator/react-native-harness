import { HarnessError } from '@react-native-harness/tools';
import type { PrewarmState } from './types.js';

export type StartupStallCode =
  | 'metro_not_ready'
  | 'bundle_request_not_observed'
  | 'ready_not_reported';

export type StartupStallDetails = {
  /** Display name of the bundler, used in the message. */
  bundlerName: string;
  code?: StartupStallCode;
  lastMetroStatus?: string;
  prewarmState?: PrewarmState;
};

const getPrewarmSuffix = (prewarmState: PrewarmState | undefined): string => {
  switch (prewarmState) {
    case 'succeeded':
      return ' Only prewarm traffic was observed.';
    case 'pending':
      return ' The prewarm bundle was still building.';
    case 'failed':
      return ' The prewarm bundle failed to build.';
    case 'idle':
    default:
      return '';
  }
};

const getStartupStallMessage = (
  timeoutMs: number,
  attempts: number,
  details: Required<Pick<StartupStallDetails, 'code'>> &
    StartupStallDetails
) => {
  const bundlerName = details.bundlerName;
  const lastMetroStatus = details.lastMetroStatus ?? 'unknown';

  switch (details.code) {
    case 'metro_not_ready':
      return (
        `${bundlerName} did not report a healthy /status response within ${timeoutMs}ms. ` +
        `Last status: ${lastMetroStatus}.`
      );
    case 'ready_not_reported':
      return (
        `The app requested its ${bundlerName} bundle but Harness did not become ready within ${timeoutMs}ms ` +
        `after ${attempts} launch attempt${attempts === 1 ? '' : 's'}. ` +
        `Last ${bundlerName} status: ${lastMetroStatus}.`
      );
    case 'bundle_request_not_observed':
    default: {
      const prewarmSuffix = getPrewarmSuffix(details.prewarmState);

      return (
        `The app did not request its ${bundlerName} bundle after ${attempts} launch attempt${
          attempts === 1 ? '' : 's'
        } within ${timeoutMs}ms. ` +
        `Last ${bundlerName} status: ${lastMetroStatus}.${prewarmSuffix}`
      );
    }
  }
};

export class StartupStallError extends HarnessError {
  public readonly code: StartupStallCode;
  public readonly lastMetroStatus?: string;
  public readonly prewarmState: PrewarmState;

  constructor(
    public readonly timeoutMs: number,
    public readonly attempts: number,
    details: StartupStallDetails
  ) {
    const normalizedDetails = {
      bundlerName: details.bundlerName,
      code: details.code ?? 'bundle_request_not_observed',
      lastMetroStatus: details.lastMetroStatus,
      prewarmState: details.prewarmState ?? 'idle',
    };

    super(getStartupStallMessage(timeoutMs, attempts, normalizedDetails));
    this.name = 'StartupStallError';
    this.code = normalizedDetails.code;
    this.lastMetroStatus = normalizedDetails.lastMetroStatus;
    this.prewarmState = normalizedDetails.prewarmState;
  }
}
