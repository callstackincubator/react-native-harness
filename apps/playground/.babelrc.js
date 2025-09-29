module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      ['module:@react-native/babel-preset', { useTransformReactJSX: true }],
      'react-native-harness/babel-preset',
    ],
  };
};
