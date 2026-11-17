import {
  webpackBundler,
  rspackBundler,
} from '@react-native-harness/bundler-webpack';
import {
  webPlatform,
  chromium,
} from '@react-native-harness/platform-web';

export default {
  entryPoint: './src/index.tsx',
  appRegistryComponentName: 'HarnessPlaygroundWebpack',
  // Run the same tests on either bundler with HARNESS_BUNDLER=rspack.
  bundler:
    process.env.HARNESS_BUNDLER === 'rspack'
      ? rspackBundler({ config: './rspack.config.js' })
      : webpackBundler({ config: './webpack.config.js' }),
  runners: [
    webPlatform({
      name: 'chromium',
      browser: chromium('http://localhost:8081/', { headless: true }),
    }),
  ],
  defaultRunner: 'chromium',
  bridgeTimeout: 120000,
  forwardClientLogs: true,
};
