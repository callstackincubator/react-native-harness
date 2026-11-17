import type { HarnessBundler } from '@react-native-harness/bundlers';

/** Bundler name of Metro, which gates the `metro:*` plugin hooks. */
export const METRO_BUNDLER_NAME = 'metro';

export type MetroBundlerConfig = Record<string, unknown>;

/**
 * The bundler descriptor for Metro, which is what Harness uses when the
 * config sets no `bundler`.
 */
export const metroBundler = (): HarnessBundler<MetroBundlerConfig> => ({
  name: METRO_BUNDLER_NAME,
  displayName: 'Metro',
  module: new URL('./bundler.js', import.meta.url).href,
  config: {},
});
