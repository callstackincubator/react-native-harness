import {Platform} from 'react-native';

const METRO_URL = 'http://localhost:8081';

const getModuleUrl = (fileName: string): string => {
  const bundleName = fileName.split('.').slice(0, -1).join('.') + '.bundle';
  return `${METRO_URL}/${bundleName}?modulesOnly=true&platform=${Platform.OS}`;
};

export const fetchModule = async (fileName: string): Promise<string> => {
  const url = getModuleUrl(fileName);
  const response = await fetch(url);
  console.log(url);
  return response.text();
};

export const executeModule = (moduleJs: string): void => {
  console.log(moduleJs);
  const __rMatch = moduleJs.match(/__r\((\d+)\)/)!;
  const __rParam = __rMatch[1]!;

  // eslint-disable-next-line no-eval
  eval(moduleJs);
  // @ts-ignore - __r is injected by Metro bundler
  __r(Number(__rParam));
};
