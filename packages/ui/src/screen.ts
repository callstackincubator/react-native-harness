import { type ViewInfo } from './types.js';
import { waitFor } from '@react-native-harness/runtime';
import HarnessUI from './harness.js';

/**
 * Represents an element found on screen with its position and dimensions.
 * This can be used with userEvent.press() to interact with the element.
 */
export type ElementReference = ViewInfo;

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
   * Captures a screenshot of the entire app window or a specific element.
   * @param element Optional element reference to capture. If not provided, captures the entire window.
   * @returns Promise resolving to ScreenshotResult with PNG data, or null if capture fails.
   */
  screenshot: (element?: ElementReference) => Promise<ScreenshotResult | null>;
};

const createScreen = (): Screen => {
  return {
    findByTestId: async (testId: string): Promise<ElementReference> => {
      return waitFor(() => {
        const result = HarnessUI.queryByTestId(testId);
        if (!result) {
          throw new Error(`Unable to find element with testID: ${testId}`);
        }
        return result;
      });
    },

    findAllByTestId: async (testId: string): Promise<ElementReference[]> => {
      return waitFor(() => {
        const results = HarnessUI.queryAllByTestId(testId);
        if (results.length === 0) {
          throw new Error(`Unable to find any elements with testID: ${testId}`);
        }
        return results;
      });
    },

    queryByTestId: (testId: string): ElementReference | null => {
      return HarnessUI.queryByTestId(testId);
    },

    queryAllByTestId: (testId: string): ElementReference[] => {
      return HarnessUI.queryAllByTestId(testId);
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
        return result;
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
        return results;
      });
    },

    queryByAccessibilityLabel: (label: string): ElementReference | null => {
      return HarnessUI.queryByAccessibilityLabel(label);
    },

    queryAllByAccessibilityLabel: (label: string): ElementReference[] => {
      return HarnessUI.queryAllByAccessibilityLabel(label);
    },

    screenshot: async (
      element?: ElementReference
    ): Promise<ScreenshotResult | null> => {
      const bounds = element ?? null;
      const base64String = await HarnessUI.captureScreenshot(bounds);

      if (!base64String) {
        return null;
      }

      const width = element?.width ?? 0;
      const height = element?.height ?? 0;

      // Decode Base64 string to Uint8Array
      const binaryString = atob(base64String);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return {
        data: bytes,
        width,
        height,
      };
    },
  };
};

export const screen = createScreen();
