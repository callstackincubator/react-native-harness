import type { CustomResolutionContext, Resolution } from 'metro-resolver';

export type HarnessResolver = (context: CustomResolutionContext, moduleName: string, platform: string | null) => Resolution | null;
export type MetroResolver = (context: CustomResolutionContext, moduleName: string, platform: string | null) => Resolution;