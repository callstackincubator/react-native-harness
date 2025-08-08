import { AppRegistry } from 'react-native';
import App from './app/App';
import { getEntryComponent } from '@react-native-harness/runtime';

AppRegistry.registerComponent('Playground', () => getEntryComponent(App));
