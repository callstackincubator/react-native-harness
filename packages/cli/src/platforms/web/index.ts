import {
  TestRunnerConfig,
  assertWebRunnerConfig,
} from '@react-native-harness/config';
import { PlatformAdapter } from '../platform-adapter.js';

export const webPlatformAdapter: PlatformAdapter = {
  name: 'web',
  getEnvironment: async (runner: TestRunnerConfig) => {
    assertWebRunnerConfig(runner);

    throw new Error('Web platform is currently disabled.');
  },
};

export default webPlatformAdapter;
