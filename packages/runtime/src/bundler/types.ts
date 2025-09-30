import { BundlerEvents } from '@react-native-harness/bridge';
import { EventEmitter } from '../utils/emitter.js';

export type Bundler = {
  events: EventEmitter<BundlerEvents>;
  getModule: (filePath: string) => Promise<string>;
};
