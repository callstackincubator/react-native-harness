import { remote } from 'webdriverio';
import { InteractionEngine } from '../types.js';
import { assertNativeRunner, Config } from '@react-native-harness/config';
import { createAppiumInteractionEngine } from './engine.js';
import { runAppiumServer } from './server.js';

const APPIUM_PORT = 4723;

export const getAppiumInteractionEngine = async (
  config: Config
): Promise<InteractionEngine> => {
  assertNativeRunner(config);

  const capabilities = {
    // TODO: Function?
    platformName: config.runner.platform === 'ios' ? 'iOS' : 'Android',
    'appium:automationName':
      config.runner.platform === 'ios' ? 'XCUITest' : 'UiAutomator2',
    'appium:deviceName': config.runner.deviceId,
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
