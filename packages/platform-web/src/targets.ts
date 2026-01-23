import { RunTarget } from '@react-native-harness/platforms';

export const getRunTargets = async (): Promise<RunTarget[]> => {
  return [
    {
      type: 'browser',
      name: 'Chromium',
      platform: 'web',
      description: 'Playwright Chromium browser',
      device: { browserType: 'chromium' },
    },
    {
      type: 'browser',
      name: 'Firefox',
      platform: 'web',
      description: 'Playwright Firefox browser',
      device: { browserType: 'firefox' },
    },
    {
      type: 'browser',
      name: 'WebKit',
      platform: 'web',
      description: 'Playwright WebKit browser',
      device: { browserType: 'webkit' },
    },
  ];
};
