import { TurboModuleRegistry, type TurboModule } from 'react-native';

/**
 * Represents a bounding box in screen coordinates (points/dp).
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Internal interface used for bridge communication.
 * This needs to be exported for TurboModule codegen.
 */
export interface ViewInfo extends BoundingBox {
  nativeId: string;
}

interface Spec extends TurboModule {
  simulatePress(nativeId: string, x: number, y: number): Promise<void>;
  queryByTestId(testId: string): ViewInfo | null;
  queryAllByTestId(testId: string): ViewInfo[];
  queryByAccessibilityLabel(label: string): ViewInfo | null;
  queryAllByAccessibilityLabel(label: string): ViewInfo[];
  captureScreenshot(bounds: ViewInfo | null): Promise<string | null>;
  typeChar(character: string): Promise<void>;
  blur(options: { submitEditing?: boolean }): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('HarnessUI');
