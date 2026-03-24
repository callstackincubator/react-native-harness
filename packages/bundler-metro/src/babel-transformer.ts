import { fileURLToPath } from 'node:url';
import { MetroConfig } from '@react-native/metro-config';

export const getHarnessBabelTransformerPath = (
  metroConfig: MetroConfig
): string => {
  const upstreamTransformerPath = metroConfig.transformer?.babelTransformerPath;

  if (!upstreamTransformerPath || typeof upstreamTransformerPath !== 'string') {
    throw new Error('Upstream transformer path is not a string');
  }

  process.env.RN_HARNESS_UPSTREAM_TRANSFORMER_PATH = upstreamTransformerPath;

  return fileURLToPath(new URL('../babel-transformer.cjs', import.meta.url));
};
