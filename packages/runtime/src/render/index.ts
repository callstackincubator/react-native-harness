import React from 'react';
import { store } from '../ui/state.js';
import type { RenderResult, RenderOptions } from './types.js';
import {
  getCurrentTestHostSession,
  type TestHostSession,
} from '../host-surface.js';

const wrapElement = (
  element: React.ReactElement,
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
): React.ReactElement => {
  if (!wrapper) {
    return element;
  }
  return React.createElement(wrapper, { children: element });
};

const waitForRender = async (
  updateElement: () => void,
  timeout: number,
  timeoutMessage: string,
  hostSession: TestHostSession | undefined,
): Promise<void> => {
  hostSession?.throwIfInterrupted();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onRendered: (() => void) | undefined;
  const work = () => new Promise<void>((resolve, reject) => {
    onRendered = resolve;
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeout);
    store.getState().setOnRenderCallback(resolve);
    updateElement();
  });

  try {
    if (hostSession) {
      await hostSession.run(work);
    } else {
      await work();
    }
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (store.getState().onRenderCallback === onRendered) {
      store.getState().setOnRenderCallback(null);
    }
  }
};

export const render = async (
  element: React.ReactElement,
  options: RenderOptions = {}
): Promise<RenderResult> => {
  const { timeout = 1000, wrapper } = options;
  const hostSession = getCurrentTestHostSession();
  hostSession?.throwIfInterrupted();

  // If an element is already rendered, unmount it first
  if (store.getState().renderedElement !== null) {
    store.getState().setRenderedElement(null);
    store.getState().setOnLayoutCallback(null);
    store.getState().setOnRenderCallback(null);
  }

  // Wrap and set the element in state (key is generated automatically)
  const wrappedElement = wrapElement(element, wrapper);
  await waitForRender(
    () => store.getState().setRenderedElement(wrappedElement),
    timeout,
    `Render timeout: Element did not mount within ${timeout}ms`,
    hostSession,
  );

  const rerender = async (newElement: React.ReactElement): Promise<void> => {
    hostSession?.throwIfInterrupted();
    if (store.getState().renderedElement === null) {
      throw new Error('No element is currently rendered. Call render() first.');
    }

    const wrappedNewElement = wrapElement(newElement, wrapper);
    await waitForRender(
      () => store.getState().updateRenderedElement(wrappedNewElement),
      timeout,
      `Rerender timeout: Element did not update within ${timeout}ms`,
      hostSession,
    );
  };

  const unmount = (): void => {
    hostSession?.throwIfInterrupted();
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
