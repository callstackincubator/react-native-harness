import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  crashFromObjectiveCSync(message: string): boolean;
  crashFromObjectiveCAsync(message: string): void;
  crashFromSwiftSync(message: string): boolean;
  crashFromSwiftAsync(message: string): void;
  crashFromKotlinSync(message: string): boolean;
  crashFromKotlinAsync(message: string): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('PlaygroundCrash');
