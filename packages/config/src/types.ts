// TODO: add types for the suite result
type SuiteResult = any;

export type Platform = 'ios' | 'android' | 'web';

export type Reporter = {
  report: (results: SuiteResult[]) => Promise<void>;
};

export type NativeTestRunnerConfig = {
  platform: Extract<Platform, 'ios' | 'android'>;
  deviceId: string;
  bundleId: string;
};

export type WebTestRunnerConfig = {
  platform: Extract<Platform, 'web'>;
};

export type TestRunnerConfig = NativeTestRunnerConfig | WebTestRunnerConfig;

export type Config = {
  include: string | string[];
  runner: TestRunnerConfig;
  reporter?: Reporter;
};
