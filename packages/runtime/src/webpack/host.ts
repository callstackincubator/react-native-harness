import type { Host } from '../host.js';
import { parseErrorStack } from './parse-error-stack.js';

// The page is served by the bundler's own server, so its origin is the dev
// server.
export const webpackHost: Host = {
  getDevServerUrl: () => window.location.origin + '/',
  reloadRuntime: () => {
    window.location.reload();
  },
  parseErrorStack,
  // A browser page has no LogBox, no React Native error handler to replace,
  // and the bundler serves it without a hot reload client.
  prepare: () => undefined,
  disableHMR: async () => undefined,
};
