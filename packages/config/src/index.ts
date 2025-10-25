export { getConfig } from './reader.js';
export type {
  Config,
  Platform,
  BrowserType,
  iOSTestRunnerConfig,
  WebTestRunnerConfig,
  VegaTestRunnerConfig,
} from './types.js';
export {
  ConfigValidationError,
  ConfigNotFoundError,
  ConfigLoadError,
} from './errors.js';
