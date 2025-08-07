export { getConfig } from './reader.js';
export type { 
    Config, 
    TestRunnerConfig, 
    Platform, 
    Reporter, 
    BrowserType,
    NativeTestRunnerConfig,
    WebTestRunnerConfig
} from './types.js';
export {
    ConfigValidationError,
    ConfigNotFoundError,
    ConfigLoadError
} from './errors.js';
export {
    isNativeRunnerConfig,
    isWebRunnerConfig,
    assertNativeRunnerConfig,
    assertWebRunnerConfig
} from './types.js';