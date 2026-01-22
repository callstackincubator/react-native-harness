import { HarnessPlatformRunner } from '@react-native-harness/platforms';
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { WebPlatformConfigSchema, type WebPlatformConfig } from './config.js';

const getWebRunner = async (
  config: WebPlatformConfig
): Promise<HarnessPlatformRunner> => {
  const parsedConfig = WebPlatformConfigSchema.parse(config);

  let browser: Browser | null = null;
  let page: Page | null = null;

  const launchBrowser = async () => {
    const browserType = {
      chromium,
      firefox,
      webkit,
    }[parsedConfig.browser.type];

    browser = await browserType.launch({
      headless: parsedConfig.browser.headless,
      channel: parsedConfig.browser.channel,
      executablePath: parsedConfig.browser.executablePath,
    });

    const context = await browser.newContext();
    page = await context.newPage();

    // Expose functions for the UI package bridge
    await page.exposeFunction(
      '__RN_HARNESS_CAPTURE_SCREENSHOT__',
      async (
        bounds: { x: number; y: number; width: number; height: number } | null
      ) => {
        if (!page) return null;
        const buffer = await page.screenshot({
          clip: bounds
            ? {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              }
            : undefined,
        });
        return buffer.toString('base64');
      }
    );

    await page.exposeFunction(
      '__RN_HARNESS_SIMULATE_PRESS__',
      async (x: number, y: number) => {
        if (!page) return;
        await page.mouse.click(x, y);
      }
    );

    await page.exposeFunction(
      '__RN_HARNESS_TYPE_CHAR__',
      async (char: string) => {
        if (!page) return;
        await page.keyboard.type(char);
      }
    );

    await page.exposeFunction(
      '__RN_HARNESS_BLUR__',
      async (options: { submitEditing?: boolean }) => {
        if (!page) return;
        if (options.submitEditing) {
          await page.keyboard.press('Enter');
          // Allow some time for the event to be processed
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await page.evaluate(() => {
          if (
            document.activeElement instanceof HTMLElement ||
            document.activeElement instanceof SVGElement
          ) {
            document.activeElement.blur();
          }
        });
      }
    );

    await page.goto(parsedConfig.browser.url);
  };

  return {
    startApp: async () => {
      if (!browser) {
        await launchBrowser();
      }
    },
    restartApp: async () => {
      if (page) {
        await page.reload();
      } else {
        await launchBrowser();
      }
    },
    stopApp: async () => {
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }
    },
    dispose: async () => {
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }
    },
    isAppRunning: async () => {
      return browser !== null && page !== null && !page.isClosed();
    },
  };
};

export default getWebRunner;
