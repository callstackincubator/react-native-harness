import { HarnessPlatform } from '@react-native-harness/platforms';
import { type WebPlatformConfig, type WebBrowserConfig } from './config.js';

export const webPlatform = (
  config: WebPlatformConfig
): HarnessPlatform<WebPlatformConfig> => ({
  name: config.name,
  config,
  runner: import.meta.resolve('./runner.js'),
});

export const chromium = (
  url: string,
  options: Partial<Omit<WebBrowserConfig, 'type' | 'url'>> = {}
): WebBrowserConfig => ({
  type: 'chromium',
  url,
  headless: true,
  ...options,
});

export const chrome = (
  url: string,
  options: Partial<Omit<WebBrowserConfig, 'type' | 'url' | 'channel'>> = {}
): WebBrowserConfig => ({
  type: 'chromium',
  channel: 'chrome',
  url,
  headless: true,
  ...options,
});

export const firefox = (
  url: string,
  options: Partial<Omit<WebBrowserConfig, 'type' | 'url'>> = {}
): WebBrowserConfig => ({
  type: 'firefox',
  url,
  headless: true,
  ...options,
});

export const webkit = (
  url: string,
  options: Partial<Omit<WebBrowserConfig, 'type' | 'url'>> = {}
): WebBrowserConfig => ({
  type: 'webkit',
  url,
  headless: true,
  ...options,
});
