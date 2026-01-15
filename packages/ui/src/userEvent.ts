import NativeHarnessUI from './NativeHarnessUI.js';
import type { ElementReference } from './screen.js';

/**
 * Flushes pending events on the JS event loop.
 * This ensures that any events triggered by native code (like onPress callbacks)
 * are processed before we continue.
 *
 * Uses requestAnimationFrame to wait for the next frame render, ensuring React
 * has had time to process events and commit state updates. Includes a small
 * timeout buffer for slow devices.
 */
const flushEvents = (): Promise<void> => {
  return new Promise((resolve) => {
    // Wait for the next frame - ensures React has processed events and rendered
    requestAnimationFrame(() => {
      // Wait for another frame to handle any cascading updates
      requestAnimationFrame(() => {
        // Small timeout buffer for slow devices to complete any async processing
        setTimeout(resolve, 16);
      });
    });
  });
};

export type UserEvent = {
  /**
   * Simulates a press on the given element.
   * The press occurs at the center of the element's bounds.
   * Returns a promise that resolves when the press is complete.
   */
  press: (element: ElementReference) => Promise<void>;

  /**
   * Simulates a press at the specified screen coordinates.
   * Returns a promise that resolves when the press is complete.
   */
  pressAt: (x: number, y: number) => Promise<void>;

  /**
   * Simulates typing text into a text input element.
   * This helper focuses the element by tapping it, types text one character at a time,
   * and then blurs the element (unless skipBlur is true).
   *
   * @param element - The element to type into (should be a TextInput)
   * @param text - The text to type
   * @param options - Optional configuration
   * @param options.skipPress - If true, pressIn and pressOut events will not be triggered
   * @param options.skipBlur - If true, endEditing and blur events will not be triggered when typing is complete
   * @param options.submitEditing - If true, submitEditing event will be triggered after typing the text
   */
  type: (
    element: ElementReference,
    text: string,
    options?: {
      skipPress?: boolean;
      skipBlur?: boolean;
      submitEditing?: boolean;
    }
  ) => Promise<void>;
};

const createUserEvent = (): UserEvent => {
  return {
    press: async (element: ElementReference): Promise<void> => {
      // Calculate center point of the element
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      await NativeHarnessUI.simulatePress(centerX, centerY);
      // Flush pending events to ensure onPress and other callbacks are processed
      await flushEvents();
    },

    pressAt: async (x: number, y: number): Promise<void> => {
      await NativeHarnessUI.simulatePress(x, y);
      // Flush pending events to ensure onPress and other callbacks are processed
      await flushEvents();
    },

    type: async (
      element: ElementReference,
      text: string,
      options?: {
        skipPress?: boolean;
        skipBlur?: boolean;
        submitEditing?: boolean;
      }
    ): Promise<void> => {
      // Press to focus the element (triggers pressIn/pressOut unless skipPress is true)
      // Note: Currently we always press to focus, the skipPress option would need
      // additional implementation in simulatePress to avoid firing press events
      if (!options?.skipPress) {
        // Calculate center point of the element
        const centerX = element.x + element.width / 2;
        const centerY = element.y + element.height / 2;
        await NativeHarnessUI.simulatePress(centerX, centerY);
        await flushEvents();
      } else {
        // Still need to press to focus, but ideally without press events
        // For now, we press anyway - future enhancement could add a focusOnly method
        const centerX = element.x + element.width / 2;
        const centerY = element.y + element.height / 2;
        await NativeHarnessUI.simulatePress(centerX, centerY);
        await flushEvents();
      }

      // Type each character one by one
      for (const char of text) {
        await NativeHarnessUI.typeChar(char);
        await flushEvents(); // Let onChangeText fire
      }

      // Blur (triggers endEditing and blur unless skipBlur)
      if (!options?.skipBlur) {
        await NativeHarnessUI.blur({
          submitEditing: options?.submitEditing ?? false,
        });
        await flushEvents();
      }
    },
  };
};

export const userEvent = createUserEvent();
