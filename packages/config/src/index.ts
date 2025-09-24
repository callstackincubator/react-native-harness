export { getConfig } from './reader.js';
export type {
  Config,
  TestRunnerConfig,
  Platform,
  BrowserType,
  AndroidTestRunnerConfig,
  iOSTestRunnerConfig,
  WebTestRunnerConfig,
} from './types.js';
export {
  ConfigValidationError,
  ConfigNotFoundError,
  ConfigLoadError,
} from './errors.js';
export {
  isAndroidRunnerConfig,
  isIOSRunnerConfig,
  isWebRunnerConfig,
  assertAndroidRunnerConfig,
  assertIOSRunnerConfig,
  assertWebRunnerConfig,
} from './types.js';
