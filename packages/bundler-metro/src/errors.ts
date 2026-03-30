import { HarnessError } from '@react-native-harness/tools';

export class MetroPortUnavailableError extends HarnessError {
  constructor(public readonly port: number) {
    super(`Metro port ${port} is not available`);
    this.name = 'MetroPortUnavailableError';
  }
}

export class MetroNotInstalledError extends HarnessError {
  constructor() {
    super(
      'Metro was not found in your project. This is unexpected. Please report this issue to the React Native Harness team.'
    );
    this.name = 'MetroNotInstalledError';
  }
}

export type StartupStallCode =
  | 'metro_not_ready'
  | 'bundle_request_not_observed'
  | 'ready_not_reported';

export type StartupStallDetails = {
  code?: StartupStallCode;
  lastMetroStatus?: string;
  sawPrewarmRequest?: boolean;
};

const getStartupStallMessage = (
  timeoutMs: number,
  attempts: number,
  details: Required<Pick<StartupStallDetails, 'code'>> & StartupStallDetails
) => {
  const lastMetroStatus = details.lastMetroStatus ?? 'unknown';

  switch (details.code) {
    case 'metro_not_ready':
      return (
        `Metro did not report a healthy /status response within ${timeoutMs}ms. ` +
        `Last status: ${lastMetroStatus}.`
      );
    case 'ready_not_reported':
      return (
        `The app requested its Metro bundle but Harness did not become ready within ${timeoutMs}ms ` +
        `after ${attempts} launch attempt${attempts === 1 ? '' : 's'}. ` +
        `Last Metro status: ${lastMetroStatus}.`
      );
    case 'bundle_request_not_observed':
    default: {
      const prewarmSuffix = details.sawPrewarmRequest
        ? ' Only prewarm traffic was observed.'
        : '';

      return (
        `The app did not request its Metro bundle after ${attempts} launch attempt${
          attempts === 1 ? '' : 's'
        } within ${timeoutMs}ms. ` +
        `Last Metro status: ${lastMetroStatus}.${prewarmSuffix}`
      );
    }
  }
};

export class StartupStallError extends HarnessError {
  public readonly code: StartupStallCode;
  public readonly lastMetroStatus?: string;
  public readonly sawPrewarmRequest: boolean;

  constructor(
    public readonly timeoutMs: number,
    public readonly attempts: number,
    details: StartupStallDetails = {}
  ) {
    const normalizedDetails = {
      code: details.code ?? 'bundle_request_not_observed',
      lastMetroStatus: details.lastMetroStatus,
      sawPrewarmRequest: details.sawPrewarmRequest ?? false,
    };

    super(getStartupStallMessage(timeoutMs, attempts, normalizedDetails));
    this.name = 'StartupStallError';
    this.code = normalizedDetails.code;
    this.lastMetroStatus = normalizedDetails.lastMetroStatus;
    this.sawPrewarmRequest = normalizedDetails.sawPrewarmRequest;
  }
}
