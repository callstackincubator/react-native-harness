import { TestRunnerConfig } from '@react-native-harness/config';

export type Environment = {
  restart: () => Promise<void>;
  dispose: () => Promise<void>;
};

export type PlatformAdapter = {
  name: string;
  getEnvironment: (runner: TestRunnerConfig) => Promise<Environment>;
};
