import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  /** Uncaught native crash on a background thread; void Turbo Module returns before the throw. */
  crash(message: string): void;
  /** Throws on the sync Turbo Module path (RN → JS error), without a background crash. */
  crashHandled(message: string): boolean;
}

export default TurboModuleRegistry.getEnforcing<Spec>('PlaygroundCrash');
