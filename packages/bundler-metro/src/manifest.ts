import fs from 'node:fs';
import path from 'node:path';
import { Config as HarnessConfig } from '@react-native-harness/config';
import { getHarnessManifestPath } from './paths.js';

const getManifestContent = (harnessConfig: HarnessConfig): string => {
  return `global.RN_HARNESS = { 
    appRegistryComponentName: '${harnessConfig.appRegistryComponentName}',
    disableViewFlattening: ${harnessConfig.disableViewFlattening},
  };`;
};

export const getHarnessManifest = (harnessConfig: HarnessConfig): string => {
  const manifestContent = getManifestContent(harnessConfig);
  const manifestPath = getHarnessManifestPath();

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, manifestContent);

  return manifestPath;
};
