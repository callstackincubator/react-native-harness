import { Platform } from 'react-native';
import { getDevServerUrl } from '../utils/dev-server.js';
import { BundlingFailedError } from './errors.js';

const getModuleUrl = (fileName: string): string => {
  const devServerUrl = getDevServerUrl();
  const bundleName = fileName.split('.').slice(0, -1).join('.') + '.bundle';
  const urlSearchParams = new URLSearchParams({
    modulesOnly: 'true',
    platform: Platform.OS,
  });

  return `${devServerUrl}${bundleName}?${urlSearchParams.toString()}`;
};

export const fetchModule = async (fileName: string): Promise<string> => {
  const url = getModuleUrl(fileName);
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    throw new BundlingFailedError(fileName, text);
  }

  return text;
};
