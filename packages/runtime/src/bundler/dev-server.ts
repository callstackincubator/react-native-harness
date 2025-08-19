import getDevServer from 'react-native/Libraries/Core/Devtools/getDevServer';

export const getDevServerUrl = (): string => {
  const devServer = getDevServer();
  return devServer.url;
};
