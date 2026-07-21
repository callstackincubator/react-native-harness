import HarnessUI from './harness.js';
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
      // We pass 0, 0 as coordinates when nativeId is provided.
      // Native side will resolve the view and calculate the center.
      await HarnessUI.simulatePress(element.nativeId, 0, 0);
      // Flush pending events to ensure onPress and other callbacks are processed
      await flushEvents();
    },

    pressAt: async (x: number, y: number): Promise<void> => {
      await HarnessUI.simulatePress('', x, y);
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
      // DIAGNOSTIC: time each step so a CI timeout points at the stalling await.
      // Forwarded to the harness output via `forwardClientLogs`. Grep [userEvent.type:diag].
      const t0 = Date.now();
      const step = async (label: string, run: () => Promise<unknown>) => {
        const start = Date.now();
        console.log(
          `[userEvent.type:diag] -> ${label} (t+${start - t0}ms)`
        );
        await run();
        console.log(
          `[userEvent.type:diag] <- ${label} took ${Date.now() - start}ms (t+${Date.now() - t0}ms)`
        );
      };

      // Press to focus the element (triggers pressIn/pressOut unless skipPress is true)
      await step('focus.simulatePress', () =>
        HarnessUI.simulatePress(element.nativeId, 0, 0)
      );
      await step('focus.flushEvents', () => flushEvents());

      // Type each character one by one
      let index = 0;
      for (const char of text) {
        const i = index++;
        await step(`typeChar[${i}]`, () => HarnessUI.typeChar(char));
        await step(`typeChar[${i}].flushEvents`, () => flushEvents()); // Let onChangeText fire
      }

      // Blur (triggers endEditing and blur unless skipBlur)
      if (!options?.skipBlur) {
        await step('blur', () =>
          HarnessUI.blur({
            submitEditing: options?.submitEditing ?? false,
          })
        );
        await step('blur.flushEvents', () => flushEvents());
      }

      console.log(
        `[userEvent.type:diag] done total=${Date.now() - t0}ms`
      );
    },
  };
};

export const userEvent = createUserEvent();
