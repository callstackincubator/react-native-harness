export { getConfig } from './reader.js';
export { harnessCliOptions } from './cli-options.js';
export type { Config, ResolvedDiagnosticsOptions } from './types.js';
export {
  ConfigSchema,
  DEFAULT_METRO_PORT,
  isDiagnosticsEnabled,
  resolveDiagnosticsOptions,
  resolveMetroCacheEnabled,
  resolveSkipAlreadyIncludedModules,
} from './types.js';
export {
  ConfigValidationError,
  ConfigNotFoundError,
  ConfigLoadError,
} from './errors.js';
