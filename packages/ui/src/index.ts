/**
 * @react-native-harness/ui
 *
 * Native UI testing module for React Native Harness.
 * Provides view queries and touch simulation.
 *
 * This module is automatically excluded from release builds
 * and only available in debug builds.
 */

export {
  screen,
  type Screen,
  type ElementReference,
  type ScreenshotResult,
} from './screen.js';
export { userEvent, type UserEvent } from './userEvent.js';
export type { ViewInfo } from './NativeHarnessUI.js';
