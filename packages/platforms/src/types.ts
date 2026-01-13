export type HarnessPlatformRunner = {
  startApp: () => Promise<void>;
  restartApp: () => Promise<void>;
  stopApp: () => Promise<void>;
  dispose: () => Promise<void>;
  isAppRunning: () => Promise<boolean>;
};

export type HarnessPlatform<TConfig = Record<string, unknown>> = {
  name: string;
  config: TConfig;
  runner: string;
};
