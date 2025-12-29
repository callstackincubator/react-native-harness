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
    const wrappedFactory = function (...args) {
      // 1. Your Custom Require
      const myRequire = function (id) {
        // Logic to capture/redirect the require
        // globalObject.__r is the global require function from Metro
        // @ts-ignore
        return globalObject.__r(id);
      };

      // 2. Custom importDefault (MUST use myRequire)
      const myImportDefault = function (id) {
        const mod = myRequire(id);
        return mod && mod.__esModule ? mod.default : mod;
      };

      // 3. Custom importAll (MUST use myRequire)
      const myImportAll = function (id) {
        const mod = myRequire(id);
        if (mod && mod.__esModule) {
          return mod;
        }

        const result = {};
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

      // Standard Metro with import support (7 arguments)
      // args: global, require, importDefault, importAll, module, exports, dependencyMap
      const global = args[0];
      const moduleObject = args[4];
      const exports = args[5];
      const depMap = args[6];

      return factory(
        global,
        myRequire,
        myImportDefault,
        myImportAll,
        moduleObject,
        exports,
        depMap
      );
    };

    // Call the original define with the wrapped factory
    return originalDefine.call(this, wrappedFactory, moduleId, dependencyMap);
  };

  // Implement __clearModule
  // This allows the test runner to re-evaluate modules by clearing them from the cache
  globalObject.__clearModule = function (moduleId) {
    if (globalObject.__r && globalObject.__r.getModules) {
      const modules = globalObject.__r.getModules();
      if (modules && modules.has(moduleId)) {
        modules.delete(moduleId);
      }
    }
  };

  // Implement __resetAllModules
  // This allows the test runner to reset the state of all modules
  globalObject.__resetAllModules = function () {
    if (globalObject.__r && globalObject.__r.getModules) {
      const modules = globalObject.__r.getModules();
      if (modules) {
        modules.forEach(function (mod, moduleId) {
          if (mod) {
            // We need to create a new object to ensure that the module is re-evaluated
            // Mutating existing module directly might not work as expected in some cases
            const newMod = {};
            for (const key in mod) {
              if (Object.prototype.hasOwnProperty.call(mod, key)) {
                newMod[key] = mod[key];
              }
            }
            newMod.isInitialized = false;
            modules.set(moduleId, newMod);
          }
        });
      }
    }
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