const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const exclusionList =
  require('metro-config/private/defaults/exclusionList').default;
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * The `kepler` platform and the `react-native` redirect to
 * `@amazon-devices/react-native-kepler` are added by the Vega CLI plugin for
 * `react-native start` / `build-vega`, and by the Harness Vega platform for
 * harness runs, so they are not configured here.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  cacheVersion: '@react-native-harness/playground-vega',
  watchFolders: [monorepoRoot],
  resolver: {
    unstable_enablePackageExports: true,
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    // The monorepo root is a watch folder, so keep Nx's local cache and
    // workspace data out of Metro's file map.
    blockList: exclusionList([/\.nx\/.*/]),
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
