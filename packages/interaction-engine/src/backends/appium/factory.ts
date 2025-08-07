import { remote } from 'webdriverio';
import { InteractionEngine } from '../../types.js';
import { assertNativeRunnerConfig, TestRunnerConfig } from '@react-native-harness/config';
import { UIBackendFactory } from '../types.js';
import { createAppiumInteractionEngine } from './engine.js';
import { runAppiumServer } from './server.js';

const APPIUM_PORT = 4723;

const getAppiumInteractionEngine = async (
  runner: TestRunnerConfig,
): Promise<InteractionEngine> => {
  assertNativeRunnerConfig(runner);

  const capabilities = {
    // TODO: Function?
    platformName: runner.platform === 'ios' ? 'iOS' : 'Android',
    'appium:automationName':
      runner.platform === 'ios' ? 'XCUITest' : 'UiAutomator2',
    'appium:deviceName': runner.deviceId,
    'appium:settings[disableIdLocatorAutocompletion]': true,
  };

  const wdOpts = {
    hostname: 'localhost',
    port: APPIUM_PORT,
    capabilities,
    logLevel: 'silent' as const,
  };

  await runAppiumServer({ port: APPIUM_PORT });
  const driver = await remote(wdOpts);
  return createAppiumInteractionEngine(driver);
};

export const appiumBackend: UIBackendFactory = {
  getInteractionEngine: getAppiumInteractionEngine,
  getName: () => 'appium',
};
