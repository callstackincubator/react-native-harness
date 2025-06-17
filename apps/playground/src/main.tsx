import { AppRegistry } from 'react-native';
import App from './app/App';
import { getEntryComponent, UI } from '@react-native-harness/runtime';

AppRegistry.registerComponent('Playground', () => getEntryComponent(UI));
