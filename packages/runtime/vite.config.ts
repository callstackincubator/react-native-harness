/// <reference types='vitest' />
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/runtime',
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },
  test: {
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
    alias: {
      '@vitest/spy': path.resolve(__dirname, 'node_modules/@vitest/spy'),
      '@vitest/expect': path.resolve(__dirname, 'node_modules/@vitest/expect'),
    },
  },
}));
