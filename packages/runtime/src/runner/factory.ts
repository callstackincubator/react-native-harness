import type { TestRunnerEvents } from '@react-native-harness/bridge';
import { getEmitter } from '../utils/emitter.js';
import { runSuite } from './runSuite.js';
import { TestRunner } from './types.js';

export const getTestRunner = (): TestRunner => {
  const events = getEmitter<TestRunnerEvents>();

  return {
    events,
    run: async (testSuite, testFilePath) => {
      return runSuite(testSuite, {
        events,
        testFilePath,
      });
    },
    dispose: () => {
      events.clearAllListeners();
    },
  };
};
