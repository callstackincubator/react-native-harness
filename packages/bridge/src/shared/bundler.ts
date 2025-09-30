export type ModuleBundlingStartedEvent = {
  type: 'module-bundling-started';
  file: string;
};

export type ModuleBundlingFinishedEvent = {
  type: 'module-bundling-finished';
  file: string;
  duration: number;
};

export type ModuleBundlingFailedEvent = {
  type: 'module-bundling-failed';
  file: string;
  duration: number;
  error: string;
};

export type BundlerEvents =
  | ModuleBundlingStartedEvent
  | ModuleBundlingFinishedEvent
  | ModuleBundlingFailedEvent;
