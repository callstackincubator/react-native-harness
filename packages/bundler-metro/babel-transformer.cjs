const { rnHarnessPlugins } = require('@react-native-harness/babel-preset');

const transform = (args) => {
  const { plugins } = args;
  const upstreamTransformerPath =
    process.env.RN_HARNESS_UPSTREAM_TRANSFORMER_PATH;

  if (!upstreamTransformerPath || typeof upstreamTransformerPath !== 'string') {
    throw new Error('Upstream transformer path is not a string');
  }

  const upstreamTransformer = require(upstreamTransformerPath);
  const pluginsWithHarness = [
    ...((plugins ?? [])),
    ...rnHarnessPlugins,
  ];

  return upstreamTransformer.transform({
    ...args,
    plugins: pluginsWithHarness,
  });
};

module.exports = { transform };
