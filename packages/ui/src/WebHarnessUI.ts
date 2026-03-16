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
    __RN_HARNESS_VIEW_REGISTRY__: Map<string, Element>;
  }
}

if (!window.__RN_HARNESS_VIEW_REGISTRY__) {
  window.__RN_HARNESS_VIEW_REGISTRY__ = new Map();
}

let nextId = 1;

interface HarnessElement extends Element {
  __harnessId?: string;
}

const getElementViewInfo = (element: Element): ViewInfo => {
  const rect = element.getBoundingClientRect();
  const harnessElement = element as HarnessElement;

  let nativeId = harnessElement.__harnessId;
  if (!nativeId) {
    nativeId = `view_${nextId++}`;
    harnessElement.__harnessId = nativeId;
    window.__RN_HARNESS_VIEW_REGISTRY__.set(nativeId, element);
  }

  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    nativeId,
  };
};

const WebHarnessUI: HarnessUIModule = {
  simulatePress: async (nativeId, x, y) => {
    let targetX = x;
    let targetY = y;

    if (nativeId) {
      const element = window.__RN_HARNESS_VIEW_REGISTRY__.get(nativeId);
      if (element) {
        const rect = element.getBoundingClientRect();
        targetX = rect.left + rect.width / 2;
        targetY = rect.top + rect.height / 2;
      }
    }

    await window.__RN_HARNESS_SIMULATE_PRESS__(targetX, targetY);
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
    let captureBounds = bounds;
    if (bounds?.nativeId && bounds.width === 0 && bounds.height === 0) {
      const element = window.__RN_HARNESS_VIEW_REGISTRY__.get(bounds.nativeId);
      if (element) {
        captureBounds = getElementViewInfo(element);
      }
    }
    return await window.__RN_HARNESS_CAPTURE_SCREENSHOT__(captureBounds);
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
