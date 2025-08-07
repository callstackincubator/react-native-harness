import { registerRootComponent } from 'expo';
import { getEntryComponent, UI } from '@react-native-harness/runtime';
import App from './src/app/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(getEntryComponent(UI));
