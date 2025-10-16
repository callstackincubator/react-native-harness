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

export type SetupFileBundlingStartedEvent = {
  type: 'setup-file-bundling-started';
  file: string;
  setupType: 'setupFiles' | 'setupFilesAfterEnv';
};

export type SetupFileBundlingFinishedEvent = {
  type: 'setup-file-bundling-finished';
  file: string;
  setupType: 'setupFiles' | 'setupFilesAfterEnv';
  duration: number;
};

export type SetupFileBundlingFailedEvent = {
  type: 'setup-file-bundling-failed';
  file: string;
  setupType: 'setupFiles' | 'setupFilesAfterEnv';
  duration: number;
  error: string;
};

export type BundlerEvents =
  | ModuleBundlingStartedEvent
  | ModuleBundlingFinishedEvent
  | ModuleBundlingFailedEvent
  | SetupFileBundlingStartedEvent
  | SetupFileBundlingFinishedEvent
  | SetupFileBundlingFailedEvent;
