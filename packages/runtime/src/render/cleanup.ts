import { store } from '../ui/state.js';

export const cleanup = (): void => {
  store.getState().setRenderedElement(null);
  store.getState().setOnLayoutCallback(null);
};
