import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/tsup.config.{js,cjs,mjs,ts,cts,mts}',
          ],
          ignoredDependencies: [
            'vite',
            'vitest',
            // Referenced only as a require.resolve() target to read the
            // consuming project's own installed version at runtime, not
            // imported/bundled by this package.
            '@react-native-harness/bundler-metro',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
