import { Browser } from 'webdriverio';
import { getElementHierarchy } from './debug.js';
import { QueryBy } from '../types.js';

export class InteractionEngineQueryError extends Error {
  queryBy: QueryBy;
  multiple: boolean;
  hierarchy: string;

  constructor(queryBy: QueryBy, hierarchy: string, multiple: boolean) {
    super(
      `No element${multiple ? 's' : ''} found for ${
        queryBy.locationStrategy
      }="${queryBy.value}" with strict mode enabled`
    );
    this.queryBy = queryBy;
    this.multiple = multiple;
    this.hierarchy = hierarchy;
  }
}

export const getInteractionEngineQueryError = async (
  driver: Browser,
  queryBy: QueryBy,
  multiple: boolean
): Promise<Error> => {
  const hierarchy = await getElementHierarchy(driver);
  return new InteractionEngineQueryError(queryBy, hierarchy, multiple);
};
