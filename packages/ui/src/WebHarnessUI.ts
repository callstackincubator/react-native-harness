import { type HarnessUIModule, type ViewInfo } from './types.js';

declare global {
  interface Window {
    __RN_HARNESS_CAPTURE_SCREENSHOT__: (
      bounds: ViewInfo | null
    ) => Promise<string | null>;
    __RN_HARNESS_SIMULATE_PRESS__: (x: number, y: number) => Promise<void>;
    __RN_HARNESS_TYPE_CHAR__: (character: string) => Promise<void>;
    __RN_HARNESS_BLUR__: (options: {
      submitEditing?: boolean;
    }) => Promise<void>;
  }
}

const getElementViewInfo = (element: Element): ViewInfo => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
};

const WebHarnessUI: HarnessUIModule = {
  simulatePress: async (x, y) => {
    await window.__RN_HARNESS_SIMULATE_PRESS__(x, y);
  },

  queryByTestId: (testId) => {
    const element = document.querySelector(`[data-testid="${testId}"]`);
    return element ? getElementViewInfo(element) : null;
  },

  queryAllByTestId: (testId) => {
    const elements = document.querySelectorAll(`[data-testid="${testId}"]`);
    return Array.from(elements).map(getElementViewInfo);
  },

  queryByAccessibilityLabel: (label) => {
    const element = document.querySelector(`[aria-label="${label}"]`);
    return element ? getElementViewInfo(element) : null;
  },

  queryAllByAccessibilityLabel: (label) => {
    const elements = document.querySelectorAll(`[aria-label="${label}"]`);
    return Array.from(elements).map(getElementViewInfo);
  },

  captureScreenshot: async (bounds) => {
    return await window.__RN_HARNESS_CAPTURE_SCREENSHOT__(bounds);
  },

  typeChar: async (character) => {
    await window.__RN_HARNESS_TYPE_CHAR__(character);
  },

  blur: async (options) => {
    if (options.submitEditing) {
      // If we want to submit, we must NOT blur before pressing Enter.
      // We let the runner-side bridge handle both Enter and the subsequent blur.
      await window.__RN_HARNESS_BLUR__(options);
    } else {
      // If there is a focused element, blur it directly in the DOM first
      // to trigger local events, then call the runner-side bridge.
      if (
        document.activeElement instanceof HTMLElement ||
        document.activeElement instanceof SVGElement
      ) {
        document.activeElement.blur();
      }
      await window.__RN_HARNESS_BLUR__(options);
    }
  },
};

export default WebHarnessUI;
