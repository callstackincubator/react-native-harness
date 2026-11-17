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
            // Used by the loader (resolve-weak-loader.cjs), not by the build.
            '@babel/core',
            '@react-native-harness/babel-preset',
            // Named in the generated entry and resolved by path, not imported.
            '@react-native-harness/runtime',
            // Resolved from the user's project, never imported.
            '@rspack/core',
            'webpack',
            'vite',
            'vitest',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
