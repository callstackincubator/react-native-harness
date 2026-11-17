import {
  webPlatform,
  chromium,
} from '@react-native-harness/platform-web';

// Proposed bundler wiring, see docs/adr/0002-webpack-bundler-backend.md.
// The backend does not exist yet, so none of this can be enabled today.
//
// import { webpackBundler, rspackBundler } from '@react-native-harness/bundler-webpack';
//
// Run the same tests on either bundler with HARNESS_BUNDLER=rspack:
// bundler:
//   process.env.HARNESS_BUNDLER === 'rspack'
//     ? rspackBundler({ config: './rspack.config.js' })
//     : webpackBundler({ config: './webpack.config.js' }),

export default {
  entryPoint: './src/index.tsx',
  appRegistryComponentName: 'HarnessPlaygroundWebpack',
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
