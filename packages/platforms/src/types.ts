export type CrashArtifactKind =
  | 'logcat'
  | 'ios-crash-report'
  | 'dropbox-crash'
  | 'dropbox-native-crash'
  | 'exit-info';

export type CrashEnrichmentArtifact = {
  artifactType: Exclude<
    CrashArtifactKind,
    'logcat' | 'ios-crash-report'
  >;
  artifactPath: string;
};

export type AppCrashDetails = {
  source?: 'polling' | 'logs' | 'bridge';
  summary?: string;
  signal?: string;
  exceptionType?: string;
  processName?: string;
  pid?: number;
  stackTrace?: string[];
  rawLines?: string[];
  artifactType?: CrashArtifactKind;
  artifactPath?: string;
  enrichmentArtifacts?: CrashEnrichmentArtifact[];
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
    testFilePath?: string;
  }) => string;
};

export type CrashDetailsLookupOptions = {
  processName?: string;
  pid?: number;
  occurredAt: number;
  testFilePath?: string;
};

export type AppSessionLog = {
  line: string;
  occurredAt: number;
};

export type AppSessionEvent = { type: 'app_exited' };

export type AppSessionListener = (event: AppSessionEvent) => void;

export type AppSessionState =
  | {
      status: 'running';
      pid?: number;
    }
  | {
      status: 'exited';
      occurredAt: number;
      pid?: number;
      reason?: 'observed-exit' | 'process-gone';
    }
  | {
      status: 'disposed';
      occurredAt: number;
    };

export type AppSession = {
  dispose: () => Promise<void>;
  getState: () => Promise<AppSessionState>;
  getLogs: () => AppSessionLog[];
  getCrashDetails?: (
    options: CrashDetailsLookupOptions
  ) => Promise<AppCrashDetails | null>;
  addListener: (listener: AppSessionListener) => void;
  removeListener: (listener: AppSessionListener) => void;
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

export type CollectNativeCoverageOptions = {
  pods: string[];
  outputDir: string;
};

export type HarnessPlatformRunner = {
  createAppSession: (options?: AppLaunchOptions) => Promise<AppSession>;
  dispose: () => Promise<void>;
  collectNativeCoverage?: (
    options: CollectNativeCoverageOptions
  ) => Promise<string | null>;
};

export type HarnessPlatformInitOptions = {
  signal: AbortSignal;
  crashArtifactWriter?: CrashArtifactWriter;
};

export type HarnessCliCommandContext = {
  cwd: string;
  projectRoot: string;
};

export type HarnessCliCommand = {
  name: string;
  aliases?: string[];
  run: (args: string[], context: HarnessCliCommandContext) => Promise<void>;
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
