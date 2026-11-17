// Metro's module ids are numbers; webpack's are strings in development builds.
export type ModuleId = number | string;

export type WebpackModule = {
  id: ModuleId;
  loaded: boolean;
  exports: unknown;
};

export type WebpackRequire = {
  (moduleId: ModuleId): unknown;
  /** The module cache (`RuntimeGlobals.moduleCache`). */
  c: Record<ModuleId, WebpackModule | undefined>;
  /** The module factories. */
  m: Record<ModuleId, ModuleFactory | undefined>;
  /** Interceptors that run before a module executes (`RuntimeGlobals.interceptModuleExecution`). */
  i?: Array<(options: ExecutionOptions) => void>;
};

export type ModuleFactory = (
  module: WebpackModule,
  exports: unknown,
  require: WebpackRequire
) => void;

export type ExecutionOptions = {
  id: ModuleId;
  module: WebpackModule;
  factory: ModuleFactory;
  require: WebpackRequire;
};

// Webpack and Rspack replace this identifier with the runtime's own
// `__webpack_require__`, both in the page and in any chunk.
declare const __webpack_require__: WebpackRequire;

export const getWebpackRequire = (): WebpackRequire => __webpack_require__;
