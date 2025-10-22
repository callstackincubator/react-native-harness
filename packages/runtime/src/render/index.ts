import React from 'react';
import { store } from '../ui/state.js';
import type { RenderResult, RenderOptions } from './types.js';

const wrapElement = (
  element: React.ReactElement,
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
): React.ReactElement => {
  if (!wrapper) {
    return element;
  }
  return React.createElement(wrapper, { children: element });
};

export const render = async (
  element: React.ReactElement,
  options: RenderOptions = {}
): Promise<RenderResult> => {
  const { timeout = 1000, wrapper } = options;

  // If an element is already rendered, unmount it first
  if (store.getState().renderedElement !== null) {
    store.getState().setRenderedElement(null);
    store.getState().setOnLayoutCallback(null);
    store.getState().setOnRenderCallback(null);
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

  // Wrap and set the element in state (key is generated automatically)
  const wrappedElement = wrapElement(element, wrapper);
  store.getState().setRenderedElement(wrappedElement);

  // Wait for layout
  await layoutPromise;

  const rerender = async (newElement: React.ReactElement): Promise<void> => {
    if (store.getState().renderedElement === null) {
      throw new Error('No element is currently rendered. Call render() first.');
    }

    // Create a promise that resolves when the element is re-rendered
    const renderPromise = new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        store.getState().setOnRenderCallback(null);
        reject(
          new Error(
            `Rerender timeout: Element did not update within ${timeout}ms`
          )
        );
      }, timeout);

      store.getState().setOnRenderCallback(() => {
        clearTimeout(timeoutId);
        resolve();
      });
    });

    const wrappedNewElement = wrapElement(newElement, wrapper);
    store.getState().updateRenderedElement(wrappedNewElement);

    // Wait for render
    await renderPromise;
  };

  const unmount = (): void => {
    if (store.getState().renderedElement === null) {
      return;
    }

    store.getState().setRenderedElement(null);
    store.getState().setOnLayoutCallback(null);
    store.getState().setOnRenderCallback(null);
  };

  return {
    rerender,
    unmount,
  };
};

export { cleanup } from './cleanup.js';
export type { RenderResult, RenderOptions } from './types.js';
