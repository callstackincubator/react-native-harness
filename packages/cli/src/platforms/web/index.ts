import { TestRunnerConfig, WebTestRunnerConfig, assertWebRunnerConfig } from '@react-native-harness/config';
import { logger } from '@react-native-harness/tools';
import { Browser, chromium, firefox, Page, webkit } from 'playwright';
import { PlatformAdapter } from '../platform-adapter.js';
import { runMetro } from '../../bundlers/metro.js';

const runBrowser = async (
  url: string,
  browserType: WebTestRunnerConfig['browser']
): Promise<{ browser: Browser; page: Page }> => {
  // For now, we're only supporting Firefox, but this will be expanded
  // to support other browsers based on the config
  let browser: Browser;
  
  switch (browserType) {
    case 'firefox':
      browser = await firefox.launch({
        headless: false,
        devtools: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--allow-insecure-localhost',
          '--ignore-certificate-errors',
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
      });
      break;
    case 'chrome':
      browser = await chromium.launch({
        headless: false,
        devtools: false,
      });
      break;
    case 'safari':
      browser = await webkit.launch({
        headless: false,
        devtools: false,
      });
      break;
    default:
      throw new Error(`Unsupported browser type: ${browserType}`);
  }

  const context = await browser.newContext({
    bypassCSP: true,
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  return { browser, page };
};

export const webPlatformAdapter: PlatformAdapter = {
  name: 'web',
  getEnvironment: async (runner: TestRunnerConfig) => {
    assertWebRunnerConfig(runner);
    
    logger.debug('Starting web environment');
    


    logger.debug('Running metro');
    const metro = await runMetro(true);
    logger.debug('Metro running');

    logger.debug(`Running browser: ${runner.browser}`);
    const { browser, page } = await runBrowser('http://localhost:8081', runner.browser);
    logger.debug('Browser running');
    


    return {
      restart: async () => {
        logger.debug('Reloading page');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      },
      dispose: async () => {
        logger.debug('Closing browser');
        await browser.close();

        metro.kill();
      },
    };
  },
};

export default webPlatformAdapter;
