import type { MockRegistry, ModuleFactory } from '../module-system.js';
import {
  getWebpackRequire,
  type ModuleId,
  type WebpackModule,
} from './webpack-require.js';

const asModuleId = (moduleId: string): ModuleId => moduleId;

let registry: MockRegistry | undefined;

// Registers an interceptor on `__webpack_require__.i` and keeps the mocks in
// it. Called when the public mock API is first imported, not when the module
// system is installed.
export const createMockRegistry = (): MockRegistry => {
  if (registry) {
    return registry;
  }

  const webpackRequire = getWebpackRequire();
  const interceptors = webpackRequire.i;

  if (!interceptors) {
    throw new Error(
      'The webpack module system is not available. The Harness webpack plugin adds it to the build; it is missing from this one.'
    );
  }

  const mocks = new Map<ModuleId, ModuleFactory>();
  // The instance of a mocked module that existed before it was mocked, if
  // any, or the one `requireActual` made. It is what the module cache holds
  // again once the mock is gone, so that `unmock` and `resetModules` give back
  // the module other modules are already bound to, as they do under Metro.
  const realModules = new Map<ModuleId, WebpackModule | undefined>();

  interceptors.push((options) => {
    const factory = mocks.get(options.id);

    if (factory) {
      options.factory = (module) => {
        module.exports = factory();
      };
    }
  });

  const takeOutOfCache = (moduleId: ModuleId): void => {
    if (!realModules.has(moduleId)) {
      realModules.set(moduleId, webpackRequire.c[moduleId]);
    }

    delete webpackRequire.c[moduleId];
  };

  const putBackIntoCache = (moduleId: ModuleId): void => {
    const real = realModules.get(moduleId);
    realModules.delete(moduleId);

    if (real) {
      webpackRequire.c[moduleId] = real;
    } else {
      delete webpackRequire.c[moduleId];
    }
  };

  const evaluateReal = (moduleId: ModuleId): WebpackModule => {
    const factory = webpackRequire.m[moduleId];

    if (!factory) {
      throw new Error(`Module ${String(moduleId)} is not part of the build`);
    }

    const module: WebpackModule = { id: moduleId, loaded: false, exports: {} };
    factory.call(module.exports, module, module.exports, webpackRequire);
    module.loaded = true;

    return module;
  };

  const mock = (moduleId: string, factory: () => unknown): void => {
    const id = asModuleId(moduleId);
    mocks.set(id, factory);
    // The next require runs the factory.
    takeOutOfCache(id);
  };

  const unmock = (moduleId: string): void => {
    const id = asModuleId(moduleId);
    mocks.delete(id);

    if (realModules.has(id)) {
      putBackIntoCache(id);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requireActual = <T = any>(moduleId: string): T => {
    // babel plugin will transform 'moduleId' to the module's id
    const id = asModuleId(moduleId);

    if (!mocks.has(id)) {
      return webpackRequire(id) as T;
    }

    let real = realModules.get(id);

    if (!real) {
      real = evaluateReal(id);
      realModules.set(id, real);
    }

    return real.exports as T;
  };

  // Clears Harness's own state only. Webpack's module cache keeps everything
  // that is not mocked, and a module that already ran keeps its dependencies.
  const resetModules = (): void => {
    mocks.clear();

    for (const id of [...realModules.keys()]) {
      putBackIntoCache(id);
    }
  };

  registry = { mock, unmock, requireActual, resetModules };

  return registry;
};

/** @internal Test-only: forget the registry so a test can create another. */
export const forgetMockRegistryForTests = (): void => {
  registry = undefined;
};
