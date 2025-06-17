import {ComponentType} from 'react';

declare global {
  var RN_HARNESS: boolean;
}

export const getEntryComponent = (Component: ComponentType) => {
  if ('RN_HARNESS' in global) {
    return require('./ui/UI').default;
  }

  return Component;
};
