import { BundlerEvents } from '@react-native-harness/bridge';
import type { LoadedModule } from '../module-system.js';
import { EventEmitter } from '../utils/emitter.js';

export type Bundler = {
  events: EventEmitter<BundlerEvents>;
  getModule: (filePath: string) => Promise<LoadedModule>;
  releaseModule: (filePath: string) => Promise<void>;
};
