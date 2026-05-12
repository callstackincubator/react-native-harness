export type AppCrashDetails = {
  source?: 'polling' | 'logs' | 'bridge';
  summary?: string;
  signal?: string;
  exceptionType?: string;
  processName?: string;
  pid?: number;
  stackTrace?: string[];
  rawLines?: string[];
  artifactType?: 'logcat' | 'ios-crash-report';
  artifactPath?: string;
};

export type CrashArtifactSource =
  | {
      kind: 'file';
      path: string;
    }
  | {
      kind: 'text';
      fileName: string;
      text: string;
    };

export type CrashArtifactWriter = {
  runTimestamp: string;
  persistArtifact: (options: {
    artifactKind: string;
    source: CrashArtifactSource;
  }) => string;
};

export type CreateAppMonitorOptions = {
  crashArtifactWriter?: CrashArtifactWriter;
};

export type CrashDetailsLookupOptions = {
  processName?: string;
  pid?: number;
  occurredAt: number;
};

export type AppMonitorEvent =
  | {
      type: 'app_started';
      pid?: number;
      source?: 'polling' | 'logs';
      line?: string;
    }
  | {
      type: 'app_exited';
      pid?: number;
      source?: 'polling' | 'logs';
      line?: string;
      isConfirmed?: boolean;
      crashDetails?: AppCrashDetails;
    }
  | {
      type: 'possible_crash';
      pid?: number;
      source?: 'polling' | 'logs';
      line?: string;
      isConfirmed?: boolean;
      crashDetails?: AppCrashDetails;
    }
  | {
      type: 'log';
      source?: 'polling' | 'logs';
      line: string;
    };

export type AppMonitorListener = (event: AppMonitorEvent) => void;

export type AppMonitor = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
  addListener: (listener: AppMonitorListener) => void;
  removeListener: (listener: AppMonitorListener) => void;
};

export type AndroidAppLaunchOptions = {
  extras?: Record<string, string | number | boolean>;
};

export type AppleAppLaunchOptions = {
  arguments?: string[];
  environment?: Record<string, string>;
};

export type WebAppLaunchOptions = Record<string, never>;

export type VegaAppLaunchOptions = Record<string, never>;

export type AppLaunchOptions =
  | AndroidAppLaunchOptions
  | AppleAppLaunchOptions
  | WebAppLaunchOptions
  | VegaAppLaunchOptions;

export type HarnessPlatformRunner = {
  startApp: (options?: AppLaunchOptions) => Promise<void>;
  restartApp: (options?: AppLaunchOptions) => Promise<void>;
  stopApp: () => Promise<void>;
  dispose: () => Promise<void>;
  isAppRunning: () => Promise<boolean>;
  createAppMonitor: (options?: CreateAppMonitorOptions) => AppMonitor;
  getCrashDetails?: (
    options: CrashDetailsLookupOptions,
  ) => Promise<AppCrashDetails | null>;
};

export type HarnessPlatformInitOptions = {
  signal: AbortSignal;
};

export type HarnessCliCommandContext = {
  cwd: string;
  projectRoot: string;
};

export type HarnessCliCommand = {
  name: string;
  aliases?: string[];
  run: (
    args: string[],
    context: HarnessCliCommandContext
  ) => Promise<void>;
};

export type HarnessCliModule = {
  commands: HarnessCliCommand[];
};

export type HarnessPlatform<TConfig = Record<string, unknown>> = {
  name: string;
  config: TConfig;
  runner: string;
  cli?: string;
  platformId: string;
  getResourceLockKey?: () => string | Promise<string>;
};

export type AndroidEmulatorRunTarget = {
  type: 'emulator';
  name: string;
  platform: 'android';
  description?: string;
  device: {
    name: string;
  };
};

export type AndroidPhysicalRunTarget = {
  type: 'physical';
  name: string;
  platform: 'android';
  description?: string;
  device: {
    manufacturer: string;
    model: string;
  };
};

export type AppleSimulatorRunTarget = {
  type: 'emulator';
  name: string;
  platform: 'ios';
  description?: string;
  device: {
    name: string;
    systemVersion: string;
  };
};

export type ApplePhysicalRunTarget = {
  type: 'physical';
  name: string;
  platform: 'ios';
  description?: string;
  device: {
    name: string;
  };
};

export type WebRunTarget = {
  type: 'browser';
  name: string;
  platform: 'web';
  description?: string;
  device: {
    browserType: 'chromium' | 'firefox' | 'webkit';
  };
};

export type RunTarget =
  | AndroidEmulatorRunTarget
  | AndroidPhysicalRunTarget
  | AppleSimulatorRunTarget
  | ApplePhysicalRunTarget
  | WebRunTarget;
