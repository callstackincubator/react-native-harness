import type { TestRunnerEvents } from '@react-native-harness/bridge';
import { getEmitter } from '../utils/emitter.js';
import { runSuite } from './runSuite.js';
import { TestRunner } from './types.js';

export const getTestRunner = (): TestRunner => {
  const events = getEmitter<TestRunnerEvents>();

  return {
    events,
    run: async (testSuite, testFilePath) => {
      const result = await runSuite(testSuite, {
        events,
        testFilePath,
      });

      // If coverage is enabled, there will be a global variable called __coverage__
      if ('__coverage__' in global && !!global.__coverage__) {
        result.coverage = global.__coverage__;
      }

      return result;
    },
    dispose: () => {
      events.clearAllListeners();
    },
  };
};
