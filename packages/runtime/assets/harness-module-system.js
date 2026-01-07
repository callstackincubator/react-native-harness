// @ts-nocheck
/* eslint-disable */

// This file is a polyfill that monkey-patches the Metro module system
// to allow capturing nested require calls.

(function (globalObject) {
  const myRequire = function (id) {
    return globalObject.__r(id);
  };

  const myImportDefault = function (id) {
    return globalObject.__r.importDefault(id);
  };

  const myImportAll = function (id) {
    return globalObject.__r.importAll(id);
  };

  // Monkey-patch define
  const originalDefine = globalObject.__d;
  globalObject.__d = function (factory, moduleId, dependencyMap) {
    const wrappedFactory = function (...args) {
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

  globalObject.__resetModule = function (moduleId) {
    const module = globalObject.__r.getModules().get(moduleId);

    if (!module) {
      return;
    }

    module.hasError = false;
    module.error = undefined;
    module.isInitialized = false;
  };

  globalObject.__resetModules = function () {
    const modules = globalObject.__r.getModules();

    modules.forEach(function (mod, moduleId) {
      globalObject.__resetModule(moduleId);
    });
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
