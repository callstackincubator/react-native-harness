import type {
  BundlerFactoryOptions,
  BundlerInstance,
  HarnessBundler,
  HarnessBundlerFactory,
} from '@react-native-harness/bundlers';
import { metroBundler } from '@react-native-harness/bundler-metro';
import type { Config as HarnessConfig } from '@react-native-harness/config';

/** The bundler the config names, or Metro when it names none. */
export const resolveBundler = (
  config: Pick<HarnessConfig, 'bundler'>
): HarnessBundler => config.bundler ?? metroBundler();

/**
 * Imports the module the descriptor points at and creates the bundler
 * instance with the descriptor's own `config`.
 */
export const createBundlerInstance = async (
  bundler: HarnessBundler,
  options: Omit<
    BundlerFactoryOptions<Record<string, unknown>, HarnessConfig>,
    'config'
  >,
  signal: AbortSignal
): Promise<BundlerInstance> => {
  const module = (await import(bundler.module)) as {
    default: HarnessBundlerFactory<Record<string, unknown>, HarnessConfig>;
  };

  return await module.default({ ...options, config: bundler.config }, signal);
};
