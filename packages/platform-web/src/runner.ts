import {
  createAppSessionEmitter,
  type AppSession,
  type AppSessionState,
  type HarnessPlatformInitOptions,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { WebPlatformConfigSchema, type WebPlatformConfig } from './config.js';

const getWebRunner = async (
  config: WebPlatformConfig,
  init?: HarnessPlatformInitOptions
): Promise<HarnessPlatformRunner> => {
  void init;
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
      ignoreDefaultArgs: parsedConfig.browser.ignoreDefaultArgs,
    });

    const context = await browser.newContext();
    page = await context.newPage();

    // Expose functions for the UI package bridge
    await page.exposeFunction(
      '__RN_HARNESS_CAPTURE_SCREENSHOT__',
      async (
        bounds: {
          x: number;
          y: number;
          width: number;
          height: number;
          nativeId: string;
        } | null
      ) => {
        if (!page) return null;

        if (bounds?.nativeId) {
          try {
            const elementHandle = await page.evaluateHandle((id) => {
              const harnessWindow = window as Window & {
                __RN_HARNESS_VIEW_REGISTRY__?: Map<string, Element>;
              };
              return harnessWindow.__RN_HARNESS_VIEW_REGISTRY__?.get(id);
            }, bounds.nativeId);

            const element = elementHandle.asElement();
            if (element) {
              const buffer = await element.screenshot();
              return buffer.toString('base64');
            }
          } catch (e) {
            // Fallback to page screenshot if element screenshot fails
            console.warn(
              `Failed to capture element screenshot for ${bounds.nativeId}, falling back to clip`,
              e
            );
          }
        }

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
    createAppSession: async (): Promise<AppSession> => {
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }
      await launchBrowser();

      const emitter = createAppSessionEmitter();
      let state: AppSessionState = { status: 'running' };

      page?.on('close', () => {
        if (state.status === 'running') {
          state = { status: 'exited', occurredAt: Date.now(), reason: 'observed-exit' };
          emitter.emit({ type: 'app_exited' });
        }
      });

      return {
        dispose: async () => {
          if (state.status === 'disposed') {
            return;
          }

          state = { status: 'disposed', occurredAt: Date.now() };
          emitter.clear();
          if (browser) {
            await browser.close();
            browser = null;
            page = null;
          }
        },
        getState: async () => state,
        getLogs: () => [],
        addListener: emitter.addListener,
        removeListener: emitter.removeListener,
      };
    },
    dispose: async () => {
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }
    },
  };
};

export default getWebRunner;
