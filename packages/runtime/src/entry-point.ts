import { AppRegistry, Platform } from 'react-native';
import { getHarnessGlobal } from './globals.js';
import { UI } from './ui/index.js';

const componentName = getHarnessGlobal().appRegistryComponentName;

AppRegistry.registerComponent(componentName, () => UI);

if (Platform.OS === 'web') {
    AppRegistry.runApplication(componentName, {
        rootTag: document.getElementById('root'),
    });
}