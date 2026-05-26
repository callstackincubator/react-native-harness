import { Platform } from 'react-native';
import getDevServer from 'react-native/Libraries/Core/Devtools/getDevServer';

export const getDevServerUrl = (): string => {
  if (Platform.OS === 'web') {
    // This is going to be the same as the current URL
    return window.location.origin + '/';
  }
  
  
  const devServer = getDevServer();
  return devServer.url;
};
