import path from 'node:path';
import fs from 'node:fs';
import { Config as HarnessConfig } from '@react-native-harness/config';

const getManifestContent = (harnessConfig: HarnessConfig): string => {
  return `global.RN_HARNESS = { 
    appRegistryComponentName: '${harnessConfig.appRegistryComponentName}',
    webSocketPort: ${harnessConfig.webSocketPort}
  };`;
};

export const getHarnessManifest = (harnessConfig: HarnessConfig): string => {
  const manifestContent = getManifestContent(harnessConfig);
  const manifestPath = path.resolve(
    process.cwd(),
    'node_modules/.cache/rn-harness/manifest.js'
  );

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, manifestContent);

  return manifestPath;
};
