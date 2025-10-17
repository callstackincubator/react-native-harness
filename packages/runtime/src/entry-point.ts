import { AppRegistry } from 'react-native';
import { getHarnessGlobal } from './globals.js';
import { UI } from './ui/index.js';

AppRegistry.registerComponent(
  getHarnessGlobal().appRegistryComponentName,
  () => UI
);
