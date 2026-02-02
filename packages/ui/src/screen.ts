import { type ViewInfo, type BoundingBox } from './types.js';
import { waitFor } from '@react-native-harness/runtime';
import HarnessUI from './harness.js';

/**
 * Represents an element found on screen.
 * This is an opaque reference that can be used with userEvent or screenshot.
 */
export type ElementReference = {
  readonly nativeId: string;
};

const wrapElement = (viewInfo: ViewInfo): ElementReference => ({
  nativeId: viewInfo.nativeId,
});

/**
 * Screenshot result containing PNG image data.
 */
export interface ScreenshotResult {
  /** PNG image data as Uint8Array (ArrayBuffer view) */
  data: Uint8Array;
  /** Width of the captured image in logical pixels (points/dp) */
  width: number;
  /** Height of the captured image in logical pixels (points/dp) */
  height: number;
}

export type Screen = {
  /**
   * Finds an element by its testID (accessibilityIdentifier on iOS, tag on Android).
   * @throws Error if no element is found with the given testID.
   */
  findByTestId: (testId: string) => Promise<ElementReference>;

  /**
   * Finds all elements by testID (accessibilityIdentifier on iOS, tag on Android).
   * @throws Error if no elements are found with the given testID.
   */
  findAllByTestId: (testId: string) => Promise<ElementReference[]>;

  /**
   * Queries for an element by its testID without throwing.
   * Returns null if no element is found.
   */
  queryByTestId: (testId: string) => ElementReference | null;

  /**
   * Queries for all elements by testID without throwing.
   * Returns an empty array if no elements are found.
   */
  queryAllByTestId: (testId: string) => ElementReference[];

  /**
   * Finds an element by its accessibility label.
   * @throws Error if no element is found with the given label.
   */
  findByAccessibilityLabel: (label: string) => Promise<ElementReference>;

  /**
   * Finds all elements by accessibility label.
   * @throws Error if no elements are found with the given label.
   */
  findAllByAccessibilityLabel: (label: string) => Promise<ElementReference[]>;

  /**
   * Queries for an element by its accessibility label without throwing.
   * Returns null if no element is found.
   */
  queryByAccessibilityLabel: (label: string) => ElementReference | null;

  /**
   * Queries for all elements by accessibility label without throwing.
   * Returns an empty array if no elements are found.
   */
  queryAllByAccessibilityLabel: (label: string) => ElementReference[];

  /**
   * Captures a screenshot of the entire app window, a specific element, or a region.
   * @param target Optional element reference or bounding box to capture. If not provided, captures the entire window.
   * @returns Promise resolving to ScreenshotResult with PNG data, or null if capture fails.
   */
  screenshot: (
    target?: ElementReference | BoundingBox
  ) => Promise<ScreenshotResult | null>;
};

const createScreen = (): Screen => {
  return {
    findByTestId: async (testId: string): Promise<ElementReference> => {
      return waitFor(() => {
        const result = HarnessUI.queryByTestId(testId);
        if (!result) {
          throw new Error(`Unable to find element with testID: ${testId}`);
        }
        return wrapElement(result);
      });
    },

    findAllByTestId: async (testId: string): Promise<ElementReference[]> => {
      return waitFor(() => {
        const results = HarnessUI.queryAllByTestId(testId);
        if (results.length === 0) {
          throw new Error(`Unable to find any elements with testID: ${testId}`);
        }
        return results.map(wrapElement);
      });
    },

    queryByTestId: (testId: string): ElementReference | null => {
      const result = HarnessUI.queryByTestId(testId);
      return result ? wrapElement(result) : null;
    },

    queryAllByTestId: (testId: string): ElementReference[] => {
      return HarnessUI.queryAllByTestId(testId).map(wrapElement);
    },

    findByAccessibilityLabel: async (
      label: string
    ): Promise<ElementReference> => {
      return waitFor(() => {
        const result = HarnessUI.queryByAccessibilityLabel(label);
        if (!result) {
          throw new Error(
            `Unable to find element with accessibility label: ${label}`
          );
        }
        return wrapElement(result);
      });
    },

    findAllByAccessibilityLabel: async (
      label: string
    ): Promise<ElementReference[]> => {
      return waitFor(() => {
        const results = HarnessUI.queryAllByAccessibilityLabel(label);
        if (results.length === 0) {
          throw new Error(
            `Unable to find any elements with accessibility label: ${label}`
          );
        }
        return results.map(wrapElement);
      });
    },

    queryByAccessibilityLabel: (label: string): ElementReference | null => {
      const result = HarnessUI.queryByAccessibilityLabel(label);
      return result ? wrapElement(result) : null;
    },

    queryAllByAccessibilityLabel: (label: string): ElementReference[] => {
      return HarnessUI.queryAllByAccessibilityLabel(label).map(wrapElement);
    },

    screenshot: async (
      target?: ElementReference | BoundingBox
    ): Promise<ScreenshotResult | null> => {
      let captureBounds: ViewInfo | null = null;
      let targetWidth = 0;
      let targetHeight = 0;

      if (target) {
        if ('nativeId' in target) {
          // ElementReference
          captureBounds = {
            nativeId: target.nativeId,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          };
        } else {
          // BoundingBox
          captureBounds = {
            nativeId: '',
            ...target,
          };
          targetWidth = target.width;
          targetHeight = target.height;
        }
      }

      const base64String = await HarnessUI.captureScreenshot(captureBounds);

      if (!base64String) {
        return null;
      }

      // Decode Base64 string to Uint8Array
      const binaryString = atob(base64String);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // If we captured by nativeId, we might not know the width/height beforehand in JS.
      // But the native side returns the actual captured PNG.
      // Ideally we'd get the size from the native side, but currently the bridge doesn't return it.
      // For now we use the provided target size or 0.

      return {
        data: bytes,
        width: targetWidth,
        height: targetHeight,
      };
    },
  };
};

export const screen = createScreen();
