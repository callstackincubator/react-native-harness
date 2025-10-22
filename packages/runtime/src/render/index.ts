import { store } from '../ui/state.js';
import type { RenderResult, RenderOptions } from './types.js';

export const render = async (
  element: React.ReactElement,
  options: RenderOptions = {}
): Promise<RenderResult> => {
  const { timeout = 1000 } = options;

  // If an element is already rendered, unmount it first
  if (store.getState().renderedElement !== null) {
    store.getState().setRenderedElement(null);
    store.getState().setOnLayoutCallback(null);
  }

  // Create a promise that resolves when the element is laid out
  const layoutPromise = new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      store.getState().setOnLayoutCallback(null);
      reject(
        new Error(`Render timeout: Element did not mount within ${timeout}ms`)
      );
    }, timeout);

    store.getState().setOnLayoutCallback(() => {
      clearTimeout(timeoutId);
      resolve();
    });
  });

  // Set the element in state (key is generated automatically)
  store.getState().setRenderedElement(element);

  // Wait for layout
  await layoutPromise;

  const rerender = async (newElement: React.ReactElement): Promise<void> => {
    if (store.getState().renderedElement === null) {
      throw new Error('No element is currently rendered. Call render() first.');
    }

    store.getState().updateRenderedElement(newElement);
  };

  const unmount = (): void => {
    if (store.getState().renderedElement === null) {
      return;
    }

    store.getState().setRenderedElement(null);
    store.getState().setOnLayoutCallback(null);
  };

  return {
    rerender,
    unmount,
  };
};

export { cleanup } from './cleanup.js';
export type { RenderResult, RenderOptions } from './types.js';
