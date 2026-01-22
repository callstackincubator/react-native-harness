import { TurboModuleRegistry, type TurboModule } from 'react-native';

// This interface needs to be there for Codegen to work.
export interface ViewInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Spec extends TurboModule {
  simulatePress(x: number, y: number): Promise<void>;
  queryByTestId(testId: string): ViewInfo | null;
  queryAllByTestId(testId: string): ViewInfo[];
  queryByAccessibilityLabel(label: string): ViewInfo | null;
  queryAllByAccessibilityLabel(label: string): ViewInfo[];
  captureScreenshot(bounds: ViewInfo | null): Promise<string | null>;
  typeChar(character: string): Promise<void>;
  blur(options: { submitEditing?: boolean }): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('HarnessUI');
