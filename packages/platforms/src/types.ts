export type HarnessPlatformInstance = {
  startApp: () => Promise<void>;
  restartApp: () => Promise<void>;
  stopApp: () => Promise<void>;
  dispose: () => Promise<void>;
};

export type HarnessPlatform = {
  name: string;
  getInstance: () => Promise<HarnessPlatformInstance>;
};
