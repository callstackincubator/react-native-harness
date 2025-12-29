// @ts-nocheck
/* eslint-disable */

// This file is a polyfill that monkey-patches the Metro module system
// to allow capturing nested require calls.

(function (globalObject) {
  // @ts-ignore
  const originalDefine = globalObject.__d;

  if (!originalDefine) {
    // If __d is not defined, we are probably not in a Metro environment or
    // the module system hasn't loaded yet.
    return;
  }

  // Monkey-patch define
  // @ts-ignore
  globalObject.__d = function (factory, moduleId, dependencyMap) {
    // Create a wrapped factory
    const wrappedFactory = (
      global: any,
      _unusedRequire: any,
      _unusedImportDefault: any,
      _unusedImportAll: any,
      moduleObject: any,
      exports: any,
      dependencyMap: any
    ) => {
      // 1. Your Custom Require
      const myRequire = (id: any) => {
        // Logic to capture/redirect the require
        // globalObject.__r is the global require function from Metro
        // @ts-ignore
        return globalObject.__r(id);
      };

      // 2. Custom importDefault (MUST use myRequire)
      const myImportDefault = (id: any) => {
        const mod = myRequire(id);
        return mod && mod.__esModule ? mod.default : mod;
      };

      // 3. Custom importAll (MUST use myRequire)
      const myImportAll = (id: any) => {
        const mod = myRequire(id);
        if (mod && mod.__esModule) {
          return mod;
        }

        const result: any = {};
        if (mod) {
          for (const key in mod) {
            if (Object.prototype.hasOwnProperty.call(mod, key)) {
              result[key] = mod[key];
            }
          }
        }
        result.default = mod;
        return result;
      };

      // 4. Execute the original factory with YOUR custom functions
      return factory(
        global,
        myRequire,
        myImportDefault,
        myImportAll,
        moduleObject,
        exports,
        dependencyMap
      );
    };

    // Call the original define with the wrapped factory
    return originalDefine.call(this, wrappedFactory, moduleId, dependencyMap);
  };
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
    ? global
    : typeof window !== 'undefined'
    ? window
    : this
);
