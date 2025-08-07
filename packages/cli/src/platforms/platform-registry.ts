import { PlatformAdapter } from './platform-adapter.js';
import androidPlatformAdapter from './android/index.js';
import iosPlatformAdapter from './ios/index.js';
import webPlatformAdapter from './web/index.js';

const platformAdapters = {
  android: androidPlatformAdapter,
  ios: iosPlatformAdapter,
  web: webPlatformAdapter,
};

export const getPlatformAdapter = async (
  platformName: string
): Promise<PlatformAdapter> => {
  if (!(platformName in platformAdapters)) {
    throw new Error(`Platform adapter for ${platformName} not found`);
  }

  try {
    return platformAdapters[platformName as keyof typeof platformAdapters];
  } catch (error) {
    throw new Error(`Platform adapter for ${platformName} not found`);
  }
};
