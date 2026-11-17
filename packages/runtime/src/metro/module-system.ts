import type { ModuleSystem } from '../module-system.js';
import { fetchModule, releaseModule } from './bundle.js';
import { evaluateModule } from './evaluate.js';
import { createMockRegistry } from './mock-registry.js';

export const metroModuleSystem: ModuleSystem = {
  loadModule: async (filePath) => {
    const moduleJs = await fetchModule(filePath);

    return { run: () => evaluateModule(moduleJs, filePath) };
  },
  releaseModule,
  createMockRegistry,
};
