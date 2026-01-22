import { store } from '../ui/state.js';
import { batchedUpdate } from '../utils/batchedUpdate.js';

/**
 * Resets render-related state in a batched update.
 * Clears the rendered element and associated callbacks.
 */
export const resetRenderState = (): void => {
  batchedUpdate(() => {
    store.getState().setRenderedElement(null);
    store.getState().setOnLayoutCallback(null);
    store.getState().setOnRenderCallback(null);
  });
};
