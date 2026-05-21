import { Platform, TurboModuleRegistry } from 'react-native';

type SourceCodeModule = {
  getConstants: () => {
    scriptURL?: string;
  };
};

const FALLBACK_DEV_SERVER_URL = 'http://localhost:8081/';

const getScriptURL = (): string | null => {
  const sourceCode = TurboModuleRegistry.get<SourceCodeModule>('SourceCode');
  return sourceCode?.getConstants()?.scriptURL ?? null;
};

export const getDevServerUrl = (): string => {
  if (Platform.OS === 'web') {
    return `${window.location.origin}/`;
  }

  const scriptUrl = getScriptURL();
  const match = scriptUrl?.match(/^https?:\/\/.*?\//);
  return match?.[0] ?? FALLBACK_DEV_SERVER_URL;
};
