/**
 * Represents the position and dimensions of a view in screen coordinates (points/dp).
 */
export interface ViewInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HarnessUIModule {
  /**
   * Simulates a native press at the specified screen coordinates.
   * Returns a promise that resolves when the press action is complete.
   */
  simulatePress(x: number, y: number): Promise<void>;

  /**
   * Finds a view by its testID (accessibilityIdentifier on iOS, tag on Android).
   * Returns null if no view is found.
   */
  queryByTestId(testId: string): ViewInfo | null;

  /**
   * Finds all views by testID (accessibilityIdentifier on iOS, tag on Android).
   * Returns an empty array if no views are found.
   */
  queryAllByTestId(testId: string): ViewInfo[];

  /**
   * Finds a view by its accessibility label.
   * Returns null if no view is found.
   */
  queryByAccessibilityLabel(label: string): ViewInfo | null;

  /**
   * Finds all views by accessibility label.
   * Returns an empty array if no views are found.
   */
  queryAllByAccessibilityLabel(label: string): ViewInfo[];

  /**
   * Captures a screenshot of the app UI.
   * @param bounds Optional bounds to capture a specific region. Pass null to capture the entire window.
   * @returns Promise resolving to Base64 encoded string containing PNG data, or null on failure.
   */
  captureScreenshot(bounds: ViewInfo | null): Promise<string | null>;

  /**
   * Types a single character into the currently focused text input.
   * If no text input is focused, this is a no-op.
   */
  typeChar(character: string): Promise<void>;

  /**
   * Blurs (resigns first responder from) the currently focused element.
   * Optionally triggers submitEditing event before blur.
   */
  blur(options: { submitEditing?: boolean }): Promise<void>;
}
