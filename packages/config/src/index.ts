export { getConfig } from './reader.js';
export type { Config, TestRunnerConfig, Platform, Reporter } from './types.js';
export {
    ConfigValidationError,
    ConfigNotFoundError,
    ConfigLoadError
} from './errors.js';