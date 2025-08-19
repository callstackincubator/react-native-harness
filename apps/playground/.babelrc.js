module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      ['module:@react-native/babel-preset', { useTransformReactJSX: true }],
    ],
    plugins: [
      '@babel/plugin-transform-class-static-block',
      '@react-native-harness/metro/babel',
    ],
  };
};
