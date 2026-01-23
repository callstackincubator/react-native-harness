const { withNxMetro } = require('@nx/react-native');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');
const fs = require('fs');

const defaultConfig = getDefaultConfig(__dirname);

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const getCustomResolver = (defaultResolveRequest) => (context, moduleName, platform) => {
  if (platform === 'web') {
    if (moduleName.includes('NativeSourceCode') ||
      moduleName.includes('NativePlatformConstants') ||
      moduleName.includes('NativeDevSettings') ||
      moduleName.includes('NativeLogBox') ||
      moduleName.includes('NativeRedBox')
    ) {
      return {
        type: 'empty',
      };
    } else if (moduleName === 'react-native') {
      return {
        type: 'sourceFile',
        filePath: require.resolve('react-native-web'),
      };
    }
  }

  // Everything else: default behavior
  return defaultResolveRequest(context, moduleName, platform);
};

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
  server: {
    ...(defaultConfig.server || {}),
    enhanceMiddleware: (middleware) => {
      return (req, res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          const htmlPath = path.join(projectRoot, 'index.html');

          fs.readFile(htmlPath, 'utf8', (err, data) => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Error loading index.html: ' + err.message);
              return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
          });
          return;
        }

        return middleware(req, res, next);
      };
    },
  },
};

module.exports = withNxMetro(mergeConfig(defaultConfig, customConfig), {
  watchFolders: [monorepoRoot],
  nodeModulesPaths: [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'node_modules'),
  ],
}).then((config) => {
  // Nx overrides the resolveRequest, so we need to override it after the merge.
  config.resolver.resolveRequest = getCustomResolver(config.resolver.resolveRequest);
  return config;
});
