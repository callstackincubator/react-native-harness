const { withNxMetro } = require('@nx/react-native');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');
const { withRnHarness } = require('react-native-harness/metro');

const defaultConfig = getDefaultConfig(__dirname);

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const customConfig = {
  cacheVersion: '@react-native-harness/playground',
  resolver: {
    unstable_enablePackageExports: true,
  },
};

module.exports = withRnHarness(
  withNxMetro(mergeConfig(defaultConfig, customConfig), {
    watchFolders: [monorepoRoot],
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
  })
);
