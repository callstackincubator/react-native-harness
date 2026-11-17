import { BundlerEvents } from '@react-native-harness/bridge';
import { getEmitter } from '../utils/emitter.js';
import { Bundler } from './types.js';
import { getModuleSystem } from '../module-system.js';
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
        const loadedModule = await getModuleSystem().loadModule(filePath);
        events.emit({
          type: 'module-bundling-finished',
          file: filePath,
          duration: Date.now() - bundlingStartTime,
        });

        return loadedModule;
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
    releaseModule: (filePath) => getModuleSystem().releaseModule(filePath),
  };
};
