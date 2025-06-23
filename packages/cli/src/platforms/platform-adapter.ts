import { TestRunnerConfig } from '@react-native-harness/config';
import { InteractionEngine } from '@react-native-harness/interaction-engine';

export type Environment = {
  restart: () => Promise<void>;
  dispose: () => Promise<void>;
  interactionEngine: InteractionEngine;
};

export type PlatformAdapter = {
  name: string;
  getEnvironment: (runner: TestRunnerConfig) => Promise<Environment>;
};
