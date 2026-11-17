export type ModuleFactory = () => unknown;

/** The mock registry behind the public `mock`, `unmock`, `requireActual` and `resetModules`. */
export type MockRegistry = {
  mock: (moduleId: string, factory: ModuleFactory) => void;
  unmock: (moduleId: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireActual: <T = any>(moduleId: string) => T;
  resetModules: () => void;
};

/** A file that has been loaded and can be run. */
export type LoadedModule = {
  run: () => Promise<void>;
};

/**
 * Everything that knows how files get into the JS runtime and how `require`
 * is intercepted. Installed by the entry module the bundler swaps in.
 */
export type ModuleSystem = {
  loadModule: (filePath: string) => Promise<LoadedModule>;
  releaseModule: (filePath: string) => Promise<void>;
  // Called when `mocker/index.ts` is first evaluated, not when the module
  // system is installed: creating the registry may patch the module system's
  // `require`, which must not happen before the first test or setup file.
  createMockRegistry: () => MockRegistry;
};

let installed: ModuleSystem | undefined;

export const installModuleSystem = (moduleSystem: ModuleSystem): void => {
  installed = moduleSystem;
};

export const getModuleSystem = (): ModuleSystem => {
  if (!installed) {
    throw new Error(
      'No module system is installed. The Harness entry module for your bundler must run before any other Harness code.'
    );
  }

  return installed;
};
