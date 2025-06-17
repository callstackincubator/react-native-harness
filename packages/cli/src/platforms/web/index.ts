// import path from 'path';
// import { runWebpack } from '../../bundlers/webpack.js';
// import { PlatformAdapter } from '../platform-adapter.js';
// import { killWithAwait } from '../../process.js';
// import { Browser, firefox, Page } from 'playwright';
// import { Config } from '@react-native-harness/config';

// const runBrowser = async (
//   url: string
// ): Promise<{ browser: Browser; page: Page }> => {
//   const browser = await firefox.launch({
//     headless: false,
//     devtools: false,
//     args: [
//       '--no-sandbox',
//       '--disable-setuid-sandbox',
//       '--disable-dev-shm-usage',
//       '--disable-web-security',
//       '--allow-insecure-localhost',
//       '--ignore-certificate-errors',
//     ],
//     ignoreDefaultArgs: ['--disable-extensions'],
//   });

//   const context = await browser.newContext({
//     bypassCSP: true,
//     ignoreHTTPSErrors: true,
//   });

//   const page = await context.newPage();

//   await page.setViewportSize({ width: 1280, height: 720 });

//   await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

//   return { browser, page };
// };

// export const webPlatformAdapter: PlatformAdapter = {
//   name: 'web',
//   getEnvironment: async (_config: Config) => {
//     const webpackConfigPath = path.resolve(process.cwd(), 'webpack.config.js');
//     const webpack = await runWebpack(webpackConfigPath);

//     const { browser, page } = await runBrowser('http://localhost:8081');

//     return {
//       restart: async () => {
//         await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
//       },
//       dispose: async () => {
//         await browser.close();
//         await killWithAwait(webpack);
//       },
//     };
//   },
// };

// export default webPlatformAdapter;
