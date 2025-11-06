import type { Reporter } from './reporter.js';

export type MetroOptions = {
  projectRoot: string;
};

export type MetroInstance = {
  events: Reporter;
  dispose: () => Promise<void>;
};

export type MetroFactory = () => Promise<MetroInstance>;
