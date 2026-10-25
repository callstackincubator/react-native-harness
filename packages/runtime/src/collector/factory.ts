import type { TestCollectorEvents } from '@react-native-harness/bridge';
import { getEmitter } from '../utils/emitter.js';
import { flushOutgoingMessages } from '../utils/yield.js';
import { collectTests } from './functions.js';
import { TestCollector } from './types.js';

export const getTestCollector = (): TestCollector => {
  const events = getEmitter<TestCollectorEvents>();

  return {
    events,
    collect: async (fn, testFilePath) => {
      const start = Date.now();
      events.emit({
        type: 'collection-started',
        file: testFilePath,
      });
      // Let collection-started reach the harness before evaluating the
      // test file can block the thread.
      await flushOutgoingMessages();

      const result = await collectTests(fn);

      events.emit({
        type: 'collection-finished',
        file: testFilePath,
        duration: Date.now() - start,
        totalTests: result.totalTests,
      });

      return result;
    },
    dispose: () => {
      events.clearAllListeners();
    },
  };
};
