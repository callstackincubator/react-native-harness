import { getBridgeClient } from '@react-native-harness/bridge/client';
import { collectTests } from './rntl/describe.js';
import { fetchModule, executeModule } from './module.js';
import { runSuite } from './runner.js';
import { state } from './state.js';

const consumeTestModule = async (fileName: string) => {
  const moduleJs = await fetchModule(fileName);
  const testSuite = collectTests(() => executeModule(moduleJs));
  return testSuite;
};

export const getClient = () =>
  getBridgeClient('http://localhost:3001', {
    runTests: async (path: string) => {
      if (state.getState().status === 'running') {
        throw new Error('Already running tests');
      }

      state.getState().setStatus('running');

      try {
        const testSuite = await consumeTestModule(path);
        const results = await runSuite(testSuite);
        return results;
      } catch (error) {
        return {
          error: {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : 'Unknown',
            name: error instanceof Error ? error.name : 'Unknown',
          },
          name: 'Root',
          tests: [],
          suites: [],
          status: 'failed',
        };
      } finally {
        state.getState().setStatus('idle');
      }
    },
  });
