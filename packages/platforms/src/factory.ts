import { HarnessPlatform, HarnessPlatformInstance } from './types.js';

export type CreateHarnessPlatformParams = {
  name: string;
  getInstance: () => Promise<HarnessPlatformInstance>;
};

export const createHarnessPlatform = (
  params: CreateHarnessPlatformParams
): HarnessPlatform => ({
  name: params.name,
  getInstance: params.getInstance,
});
