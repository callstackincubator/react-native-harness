import { EventEmitter } from '../utils/emitter.js';
import { Bundler } from '../bundler/index.js';
import { BundlerEvents } from '@react-native-harness/bridge';

export type RunSetupFilesOptions = {
  setupFiles: string[];
  setupFilesAfterEnv: string[];
  events: EventEmitter<BundlerEvents>;
  bundler: Bundler;
  evaluateModule: (moduleJs: string, filePath: string) => void;
};

export const runSetupFiles = async ({
  setupFiles,
  setupFilesAfterEnv,
  events,
  bundler,
  evaluateModule,
}: RunSetupFilesOptions) => {
  for (const setupFile of setupFiles) {
    const startTime = Date.now();
    events.emit({
      type: 'setup-file-bundling-started',
      file: setupFile,
      setupType: 'setupFiles',
    });

    try {
      const setupModuleJs = await bundler.getModule(setupFile);
      events.emit({
        type: 'setup-file-bundling-finished',
        file: setupFile,
        setupType: 'setupFiles',
        duration: Date.now() - startTime,
      });
      evaluateModule(setupModuleJs, setupFile);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      events.emit({
        type: 'setup-file-bundling-failed',
        file: setupFile,
        setupType: 'setupFiles',
        duration: Date.now() - startTime,
        error: errorMessage,
      });
      throw error;
    }
  }

  for (const setupFile of setupFilesAfterEnv) {
    const startTime = Date.now();
    events.emit({
      type: 'setup-file-bundling-started',
      file: setupFile,
      setupType: 'setupFilesAfterEnv',
    });

    try {
      const setupModuleJs = await bundler.getModule(setupFile);
      events.emit({
        type: 'setup-file-bundling-finished',
        file: setupFile,
        setupType: 'setupFilesAfterEnv',
        duration: Date.now() - startTime,
      });
      evaluateModule(setupModuleJs, setupFile);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      events.emit({
        type: 'setup-file-bundling-failed',
        file: setupFile,
        setupType: 'setupFilesAfterEnv',
        duration: Date.now() - startTime,
        error: errorMessage,
      });
      throw error;
    }
  }
};
