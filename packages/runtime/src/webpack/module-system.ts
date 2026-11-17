import { BundlingFailedError } from '../bundler/errors.js';
import type { ModuleSystem } from '../module-system.js';
import { createMockRegistry } from './mock-registry.js';
import { getWebpackRequire, type ModuleId } from './webpack-require.js';

/** One test or setup file in the manifest the bundler generates. */
export type TestFileEntry = {
  id: ModuleId;
  /** Loads the file's chunk without executing the file. */
  load: () => Promise<void>;
};

/** The files of the run, keyed as the runtime receives them. */
export type TestFiles = Record<string, TestFileEntry>;

const getReason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createWebpackModuleSystem = (files: TestFiles): ModuleSystem => ({
  loadModule: async (filePath) => {
    const entry = files[filePath];

    if (!entry) {
      const reason = `${filePath} is not in the list of files this run was prepared for`;
      throw new BundlingFailedError(filePath, reason);
    }

    // Fetches the file's chunk. The file does not run until `run()`.
    try {
      await entry.load();
    } catch (error) {
      throw new BundlingFailedError(filePath, getReason(error));
    }

    return {
      run: async () => {
        // A file that ran before runs again, as it does under Metro.
        delete getWebpackRequire().c[entry.id];
        getWebpackRequire()(entry.id);
      },
    };
  },
  // Chunks stay loaded; webpack keeps no per-file graph to free.
  releaseModule: async () => undefined,
  createMockRegistry,
});
