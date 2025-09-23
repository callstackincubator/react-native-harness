import { AppRegistry } from 'react-native';

AppRegistry.registerComponent('Playground', () =>
  global.RN_HARNESS
    ? require('react-native-harness').ReactNativeHarness
    : require('./app/App').default
);
