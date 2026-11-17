import { AppRegistry } from 'react-native';
import { App } from '@app/app/App';

const APP_NAME = 'HarnessPlaygroundWebpack';

AppRegistry.registerComponent(APP_NAME, () => App);
AppRegistry.runApplication(APP_NAME, {
  rootTag: document.getElementById('root'),
});
