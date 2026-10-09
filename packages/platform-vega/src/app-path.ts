import fs from 'node:fs';
import { VegaAppPathError } from './errors.js';

export const getOptionalHarnessAppPath = (): string | undefined => {
  const appPath = process.env.HARNESS_APP_PATH;

  if (!appPath) {
    return undefined;
  }

  if (!fs.existsSync(appPath)) {
    throw new VegaAppPathError('invalid', appPath);
  }

  return appPath;
};
