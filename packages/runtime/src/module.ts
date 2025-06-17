import {Platform} from 'react-native';
import {URL, URLSearchParams} from 'react-native-url-polyfill';

const METRO_URL = 'http://localhost:8081';

const getModuleUrl = (fileName: string): string => {
  const url = new URL(METRO_URL);
  const bundleName = fileName.split('.').slice(0, -1).join('.') + '.bundle';
  url.search = new URLSearchParams({
    modulesOnly: 'true',
    platform: Platform.OS,
  }).toString();
  url.pathname = `/${bundleName}`;
  return url.toString();
};

export const fetchModule = async (fileName: string): Promise<string> => {
  const url = getModuleUrl(fileName);
  const response = await fetch(url);
  return response.text();
};

export const executeModule = (moduleJs: string): void => {
  const __rMatch = moduleJs.match(/__r\((\d+)\)/)!;
  const __rParam = __rMatch[1]!;

  // eslint-disable-next-line no-eval
  eval(moduleJs);
  // @ts-ignore - __r is injected by Metro bundler
  __r(Number(__rParam));
};
