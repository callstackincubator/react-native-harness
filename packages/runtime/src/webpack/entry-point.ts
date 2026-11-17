import { installWebpack } from './install.js';
import type { TestFiles } from './module-system.js';

/**
 * Called by the entry module the bundler swaps in, with the files the run may
 * load. Installs the module system and the host, then starts the runtime.
 */
export const start = (files: TestFiles): void => {
  installWebpack(files);
  // After the install: the runtime reads both while it evaluates.
  require('../startup.js');
};
