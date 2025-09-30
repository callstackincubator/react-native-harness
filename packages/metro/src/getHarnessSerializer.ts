import type { MetroConfig } from 'metro-config';

export type Serializer = NonNullable<
  NonNullable<MetroConfig['serializer']>['customSerializer']
>;

const getBaseSerializer = (): Serializer => {
  const baseJSBundle = require('metro/private/DeltaBundler/Serializers/baseJSBundle');
  const bundleToString = require('metro/private/lib/bundleToString');

  return (entryPoint, prepend, graph, bundleOptions) =>
    bundleToString(baseJSBundle(entryPoint, prepend, graph, bundleOptions));
};

const getAllFiles = require('metro/private/DeltaBundler/Serializers/getAllFiles');

export const getHarnessSerializer = (): Serializer => {
  const baseSerializer = getBaseSerializer();
  let mainEntryPointModules = new Set<string>();

  return async (entryPoint, preModules, graph, options) => {
    if (options.modulesOnly) {
      // This is most likely a test file
      return baseSerializer(entryPoint, preModules, graph, {
        ...options,
        processModuleFilter: (mod) => {
          if (
            options.processModuleFilter &&
            !options.processModuleFilter(mod)
          ) {
            // If the module is not allowed by the processModuleFilter, skip it
            return false;
          }

          // If the module is in the main entry point, skip it
          return !mainEntryPointModules.has(mod.path);
        },
      });
    }

    mainEntryPointModules = new Set(
      await getAllFiles(preModules, graph, options)
    );
    return baseSerializer(entryPoint, preModules, graph, options);
  };
};
