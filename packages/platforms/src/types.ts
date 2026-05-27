export type AppCrashDetails = {
  platform?: 'android' | 'ios-simulator' | 'ios-device' | 'web' | 'vega';
  kind?:
    | 'java-exception'
    | 'native-crash'
    | 'anr'
    | 'watchdog'
    | 'process-exit'
    | 'crash-report'
    | 'device-offline'
    | 'unknown';
  confidence?: 'low' | 'medium' | 'high';
  occurredAt?: number;
  launchId?: string;
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
  eventReporter?: AppMonitorReporter;
};

export type CrashDetailsLookupOptions = {
  processName?: string;
  pid?: number;
  occurredAt: number;
  minOccurredAt?: number;
  maxOccurredAt?: number;
};

export type AppLifecyclePhase = 'startup' | 'execution';

export type AppLifecycleEventBase = {
  launchId: string;
  at: number;
};

export type LaunchRequestedEvent = AppLifecycleEventBase & {
  type: 'launch_requested';
  reason: 'start' | 'restart' | 'ensure_ready';
};

export type LaunchCompletedEvent = AppLifecycleEventBase & {
  type: 'launch_completed';
  reason: 'start' | 'restart' | 'ensure_ready';
};

export type LaunchFailedEvent = AppLifecycleEventBase & {
  type: 'launch_failed';
  reason: 'start' | 'restart' | 'ensure_ready';
  error: unknown;
};

export type StopRequestedEvent = {
  type: 'stop_requested';
  at: number;
  reason: 'restart' | 'dispose' | 'coverage' | 'manual';
};

export type StopCompletedEvent = {
  type: 'stop_completed';
  at: number;
  reason: 'restart' | 'dispose' | 'coverage' | 'manual';
};

export type CrashWatch = {
  promise: Promise<never>;
  cancel: () => void;
};

export type AppLifecycleMonitor = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;

  launchRequested: (event: LaunchRequestedEvent) => void;
  launchCompleted: (event: LaunchCompletedEvent) => void;
  launchFailed: (event: LaunchFailedEvent) => void;
  stopRequested: (event: StopRequestedEvent) => void;
  stopCompleted: (event: StopCompletedEvent) => void;

  watch: (testFilePath: string, phase: AppLifecyclePhase) => CrashWatch;
  reset: () => void;
  isAlive: () => boolean;
};

export type AppMonitorEventBase = {
  timestamp: number;
  appPlatform: NonNullable<AppCrashDetails['platform']>;
  targetIdentifier: string;
  testFile?: string;
  phase?: AppLifecyclePhase;
  launchId?: string;
  processName?: string;
  pid?: number;
  source?: AppCrashDetails['source'];
  summary?: string;
  kind?: AppCrashDetails['kind'];
  confidence?: AppCrashDetails['confidence'];
  signal?: string;
  exceptionType?: string;
  artifactType?: AppCrashDetails['artifactType'];
  artifactPath?: string;
  crashDetails?: AppCrashDetails;
};

export type AppStartedEvent = AppMonitorEventBase & {
  type: 'app:started';
};

export type AppExitedEvent = AppMonitorEventBase & {
  type: 'app:exited';
};

export type AppCrashSuspectedEvent = AppMonitorEventBase & {
  type: 'app:crash-suspected';
};

export type AppCrashConfirmedEvent = AppMonitorEventBase & {
  type: 'app:crash-confirmed';
};

export type AppCrashReportReadyEvent = AppMonitorEventBase & {
  type: 'app:crash-report-ready';
  crashDetails: AppCrashDetails;
};

export type AppMonitorWarningEvent = AppMonitorEventBase & {
  type: 'app:monitor-warning';
  warning: string;
};

export type AppMonitorEvent =
  | AppStartedEvent
  | AppExitedEvent
  | AppCrashSuspectedEvent
  | AppCrashConfirmedEvent
  | AppCrashReportReadyEvent
  | AppMonitorWarningEvent;

export type AppMonitorReporter = (event: AppMonitorEvent) => void;

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
  startApp: (options?: AppLaunchOptions) => Promise<void>;
  restartApp: (options?: AppLaunchOptions) => Promise<void>;
  stopApp: () => Promise<void>;
  dispose: () => Promise<void>;
  isAppRunning: () => Promise<boolean>;
  createAppMonitor: (options?: CreateAppMonitorOptions) => AppLifecycleMonitor;
  collectNativeCoverage?: (
    options: CollectNativeCoverageOptions
  ) => Promise<string | null>;
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
