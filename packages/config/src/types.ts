// TODO: add types for the suite result
type SuiteResult = any;

export type Platform = 'ios' | 'android';

export type Reporter = {
  report: (results: SuiteResult[]) => Promise<void>;
};

export type TestRunnerConfig = {
  name: string;
  platform: Platform;
  deviceId: string;
  bundleId: string;
};

export type Config = {
  include: string | string[];
  runners: TestRunnerConfig[];
  defaultRunner?: string;
  reporter?: Reporter;
};
