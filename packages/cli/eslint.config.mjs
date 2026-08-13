import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          ignoredDependencies: [
            '@react-native-harness/bridge',
            '@react-native-harness/platform-android',
            '@react-native-harness/platform-apple',
            '@react-native-harness/platform-web',
            'vite',
            'vitest',
            // Referenced only as a require.resolve() target to read the
            // consuming project's own installed version at runtime, not
            // imported/bundled by this package.
            '@react-native-harness/bundler-metro',
            // Referenced only as a require.resolve() fallback root to reach
            // bundler-metro when it's nested under jest's own node_modules,
            // not imported/bundled by this package.
            '@react-native-harness/jest',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
