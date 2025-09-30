import { BundlerEvents } from '@react-native-harness/bridge';
import { getEmitter } from '../utils/emitter.js';
import { Bundler } from './types.js';
import { fetchModule } from './bundle.js';
import { BundlingFailedError } from './errors.js';

export const getBundler = (): Bundler => {
  const events = getEmitter<BundlerEvents>();

  return {
    events,
    getModule: async (filePath) => {
      const bundlingStartTime = Date.now();
      events.emit({
        type: 'module-bundling-started',
        file: filePath,
      });

      try {
        const moduleJs = await fetchModule(filePath);
        events.emit({
          type: 'module-bundling-finished',
          file: filePath,
          duration: Date.now() - bundlingStartTime,
        });

        return moduleJs;
      } catch (error) {
        events.emit({
          type: 'module-bundling-failed',
          file: filePath,
          duration: Date.now() - bundlingStartTime,
          error:
            error instanceof BundlingFailedError
              ? error.reason
              : 'Unknown error',
        });

        throw error;
      }
    },
  };
};
