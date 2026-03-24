import type { HarnessResolver, MetroResolver } from './types.js';

export const createHarnessResolver = (
  resolvers: HarnessResolver[]
): MetroResolver => {
  return (context, moduleName, platform) => {
    for (const resolver of resolvers) {
      const result = resolver(context, moduleName, platform);
      if (result != null) {
        return result;
      }
    }

    return context.resolveRequest(context, moduleName, platform);
  };
};
