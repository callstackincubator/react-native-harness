module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      ['module:@react-native/babel-preset', { useTransformReactJSX: true }],
    ],
    plugins: [
      // TODO: Think of a better way to handle this
      '@babel/plugin-transform-class-static-block',
    ],
  };
};
