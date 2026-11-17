import type {
  ExecutionOptions,
  ModuleFactory,
  ModuleId,
  WebpackModule,
  WebpackRequire,
} from '../webpack-require.js';

/**
 * A stand-in for the runtime that webpack and Rspack generate, with the same
 * execution order: cache entry first, then the interceptors, then the factory.
 */
export const createFakeWebpackRequire = (
  factories: Record<ModuleId, ModuleFactory>
): WebpackRequire => {
  const cache: Record<ModuleId, WebpackModule | undefined> = {};
  const interceptors: Array<(options: ExecutionOptions) => void> = [];

  const webpackRequire = ((moduleId: ModuleId): unknown => {
    const cached = cache[moduleId];

    if (cached) {
      return cached.exports;
    }

    const module: WebpackModule = { id: moduleId, loaded: false, exports: {} };
    cache[moduleId] = module;

    const options: ExecutionOptions = {
      id: moduleId,
      module,
      factory: factories[moduleId] as ModuleFactory,
      require: webpackRequire,
    };
    interceptors.forEach((interceptor) => interceptor(options));
    options.factory.call(
      options.module.exports,
      options.module,
      options.module.exports,
      options.require
    );
    module.loaded = true;

    return options.module.exports;
  }) as WebpackRequire;

  webpackRequire.c = cache;
  webpackRequire.m = factories;
  webpackRequire.i = interceptors;

  return webpackRequire;
};
