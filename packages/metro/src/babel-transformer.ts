import type { BabelTransformer } from 'metro-babel-transformer';
import { rnHarnessPlugins } from '@react-native-harness/babel-preset';
import { MetroConfig } from '@react-native/metro-config';

export const getHarnessBabelTransformerPath = (
  metroConfig: MetroConfig
): string => {
  const upstreamTransformerPath = metroConfig.transformer?.babelTransformerPath;

  if (!upstreamTransformerPath || typeof upstreamTransformerPath !== 'string') {
    throw new Error('Upstream transformer path is not a string');
  }

  process.env.RN_HARNESS_UPSTREAM_TRANSFORMER_PATH = upstreamTransformerPath;
  return require.resolve('./babel-transformer.js');
};

const transform: BabelTransformer['transform'] = (args) => {
  const { plugins } = args;
  const upstreamTransformerPath =
    process.env.RN_HARNESS_UPSTREAM_TRANSFORMER_PATH;

  if (!upstreamTransformerPath || typeof upstreamTransformerPath !== 'string') {
    throw new Error('Upstream transformer path is not a string');
  }

  const upstreamTransformer = require(upstreamTransformerPath);
  const pluginsWithHarness = [
    // Checked against @babel/core's type definitions - plugins are an array of PluginItem
    ...((plugins as unknown[]) ?? []),
    ...rnHarnessPlugins,
  ];

  return upstreamTransformer.transform({
    ...args,
    plugins: pluginsWithHarness,
  });
};

export { transform };
