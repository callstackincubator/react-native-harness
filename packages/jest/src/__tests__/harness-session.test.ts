import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config as JestConfig } from 'jest-runner';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AppMonitor,
  DeviceStateController,
  HarnessPlatformRunner,
} from '@react-native-harness/platforms';
import { createHarnessSession } from '../harness-session.js';

const permissionPromptWatchdogPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'platform-ios',
  'xctest-agent',
  'HarnessXCTestAgentUITests',
  'PermissionPromptWatchdog.swift',
);

const pluginManagerMocks = vi.hoisted(() => ({
  callHook: vi.fn(async () => undefined),
}));

const getConfigMock = vi.hoisted(() => vi.fn());
const resolveHarnessMetroPortMock = vi.hoisted(() => vi.fn());
const getMetroInstanceMock = vi.hoisted(() => vi.fn());
const createHarnessBridgeMock = vi.hoisted(() => vi.fn());
const createCrashMonitorMock = vi.hoisted(() => vi.fn());

vi.mock('@react-native-harness/plugins', async () => {
  const actual = await vi.importActual<typeof import('@react-native-harness/plugins')>(
    '@react-native-harness/plugins',
  );

  return {
    ...actual,
    createHarnessPluginManager: vi.fn(() => ({
      callHook: pluginManagerMocks.callHook,
    })),
  };
});

vi.mock('@react-native-harness/config', async () => {
  const actual = await vi.importActual<typeof import('@react-native-harness/config')>(
    '@react-native-harness/config',
  );

  return {
    ...actual,
    getConfig: getConfigMock,
  };
});

vi.mock('../metro-port.js', async () => {
  const actual = await vi.importActual<typeof import('../metro-port.js')>(
    '../metro-port.js',
  );

  return {
    ...actual,
    resolveHarnessMetroPort: resolveHarnessMetroPortMock,
  };
});

vi.mock('@react-native-harness/bundler-metro', async () => {
  const actual = await vi.importActual<typeof import('@react-native-harness/bundler-metro')>(
    '@react-native-harness/bundler-metro',
  );

  return {
    ...actual,
    getMetroInstance: getMetroInstanceMock,
  };
});

vi.mock('@react-native-harness/bridge/server', async () => {
  const actual = await vi.importActual<typeof import('@react-native-harness/bridge/server')>(
    '@react-native-harness/bridge/server',
  );

  return {
    ...actual,
    createHarnessBridge: createHarnessBridgeMock,
  };
});

vi.mock('../crash-monitor.js', async () => {
  const actual = await vi.importActual<typeof import('../crash-monitor.js')>(
    '../crash-monitor.js',
  );

  return {
    ...actual,
    createCrashMonitor: createCrashMonitorMock,
  };
});

const createAppMonitor = (): AppMonitor => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  addListener: vi.fn(),
  removeListener: vi.fn(),
});

type BridgeDouble = {
  ws: object;
  connection: object | null;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  nextConnection: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const makeBridge = (): BridgeDouble => ({
  ws: {},
  connection: null,
  on: vi.fn(),
  off: vi.fn(),
  nextConnection: vi.fn(),
  dispose: vi.fn(async () => undefined),
});

const makeMetroInstance = () => ({
  events: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  waitUntilHealthy: vi.fn(async () => 'packager-status:running'),
  prewarm: vi.fn(async () => false),
  dispose: vi.fn(async () => undefined),
});

const makeLockManager = () => ({
  acquire: vi.fn(async () => ({
    release: vi.fn(async () => undefined),
  })),
});

const makeCrashMonitor = () => ({
  watch: vi.fn(),
  isAlive: vi.fn(() => false),
  stop: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
  reset: vi.fn(),
  dispose: vi.fn(async () => undefined),
});

const makeDeviceState = () => ({
  permissions: {
    apply: vi.fn(async () => ({ mutation: null })),
    revert: vi.fn(),
    resetOutstanding: vi.fn(async () => undefined),
  },
}) satisfies DeviceStateController;

const makePlatformRunner = (
  overrides: Partial<HarnessPlatformRunner> = {},
): HarnessPlatformRunner => ({
  startApp: vi.fn(async () => undefined),
  restartApp: vi.fn(async () => undefined),
  stopApp: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  isAppRunning: vi.fn(async () => false),
  createAppMonitor: vi.fn(() => createAppMonitor()),
  ...overrides,
});

const globalConfig = {
  rootDir: '/project',
  watch: false,
  watchAll: false,
  collectCoverage: false,
} as JestConfig.GlobalConfig;

const harnessConfig = {
  entryPoint: 'index.js',
  appRegistryComponentName: 'App',
  runners: [
    {
      name: 'ios',
      platformId: 'ios',
      runner: './__tests__/fixtures/mock-platform-runner.ts',
      config: {},
    },
  ],
  defaultRunner: 'ios',
  metroPort: 8081,
  bridgeTimeout: 1000,
  platformReadyTimeout: 1000,
  bundleStartTimeout: 1000,
  maxAppRestarts: 1,
  resetEnvironmentBetweenTestFiles: true,
  detectNativeCrashes: false,
  forwardClientLogs: false,
  permissions: false,
  plugins: [],
  unstable__skipAlreadyIncludedModules: false,
  unstable__enableMetroCache: false,
  disableViewFlattening: false,
} as const;

describe('createHarnessSession permission cleanup', () => {
  let bridge: ReturnType<typeof makeBridge>;
  let metroInstance: ReturnType<typeof makeMetroInstance>;
  let crashMonitor: ReturnType<typeof makeCrashMonitor>;
  let lockManager: ReturnType<typeof makeLockManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = makeBridge();
    metroInstance = makeMetroInstance();
    crashMonitor = makeCrashMonitor();
    lockManager = makeLockManager();

    getConfigMock.mockResolvedValue({ config: harnessConfig });
    resolveHarnessMetroPortMock.mockResolvedValue({
      config: harnessConfig,
      initialMetroPort: 8081,
      didFallback: false,
      metroPortLease: { release: vi.fn(async () => undefined) },
    });
    getMetroInstanceMock.mockResolvedValue(metroInstance);
    createHarnessBridgeMock.mockResolvedValue(bridge);
    createCrashMonitorMock.mockReturnValue(crashMonitor);
  });

  afterEach(() => {
    delete globalThis.__HARNESS_TEST_PLATFORM_RUNNER__;
  });

  it('resets outstanding permission mutations before restart between test files', async () => {
    const deviceState = makeDeviceState();
    const platformRunner = makePlatformRunner({
      deviceState,
      isAppRunning: vi.fn(async () => true),
    });
    bridge.connection = {};
    crashMonitor.isAlive.mockReturnValue(true);
    globalThis.__HARNESS_TEST_PLATFORM_RUNNER__ = platformRunner;

    const session = await createHarnessSession(globalConfig, { lockManager });
    const callOrder: string[] = [];

    deviceState.permissions.resetOutstanding.mockImplementation(async () => {
      callOrder.push('resetOutstanding');
    });
    platformRunner.stopApp = vi.fn(async () => {
      callOrder.push('stopApp');
    });

    await session.restartApp('/test/example.ts');

    expect(deviceState.permissions.resetOutstanding).toHaveBeenCalledTimes(1);
    expect(deviceState.permissions.apply).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['resetOutstanding', 'stopApp']);

    await session.dispose();
  });

  it('reapplies configured permissions after cleanup before restart between test files', async () => {
    const deviceState = makeDeviceState();
    const platformRunner = makePlatformRunner({
      deviceState,
      isAppRunning: vi.fn(async () => true),
    });
    bridge.connection = {};
    crashMonitor.isAlive.mockReturnValue(true);
    globalThis.__HARNESS_TEST_PLATFORM_RUNNER__ = platformRunner;

    const permissionsEnabledConfig = {
      ...harnessConfig,
      permissions: true,
    } as const;
    getConfigMock.mockResolvedValue({ config: permissionsEnabledConfig });
    resolveHarnessMetroPortMock.mockResolvedValue({
      config: permissionsEnabledConfig,
      initialMetroPort: 8081,
      didFallback: false,
      metroPortLease: { release: vi.fn(async () => undefined) },
    });

    const session = await createHarnessSession(globalConfig, { lockManager });
    const callOrder: string[] = [];

    deviceState.permissions.apply.mockClear();
    deviceState.permissions.resetOutstanding.mockImplementation(async () => {
      callOrder.push('resetOutstanding');
    });
    deviceState.permissions.apply.mockImplementation(async () => {
      callOrder.push('applyConfiguredPermissions');
      return { mutation: null };
    });
    platformRunner.stopApp = vi.fn(async () => {
      callOrder.push('stopApp');
    });

    await session.restartApp('/test/example.ts');

    expect(deviceState.permissions.resetOutstanding).toHaveBeenCalledTimes(1);
    expect(deviceState.permissions.apply).toHaveBeenCalledWith({
      kind: 'permission-all',
      decision: 'grant',
    });
    expect(callOrder).toEqual([
      'resetOutstanding',
      'applyConfiguredPermissions',
      'stopApp',
    ]);

    await session.dispose();
  });

  it('resets outstanding permission mutations during dispose', async () => {
    const deviceState = makeDeviceState();
    const callOrder: string[] = [];
    const platformRunner = makePlatformRunner({ deviceState });
    deviceState.permissions.resetOutstanding.mockImplementation(async () => {
      callOrder.push('resetOutstanding');
    });
    platformRunner.dispose = vi.fn(async () => {
      callOrder.push('dispose');
    });
    globalThis.__HARNESS_TEST_PLATFORM_RUNNER__ = platformRunner;

    const session = await createHarnessSession(globalConfig, { lockManager });

    await session.dispose();

    expect(deviceState.permissions.resetOutstanding).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['resetOutstanding', 'dispose']);
  });
});

describe('ios permission watchdog labels', () => {
  it('keeps deny and grant prompt button labels disjoint', () => {
    const source = fs.readFileSync(permissionPromptWatchdogPath, 'utf8');
    const listPattern = /static let known(Positive|Negative)ButtonLabels = \[(.*?)\]/gs;
    const labelsByKind = new Map<string, string[]>();

    for (const match of source.matchAll(listPattern)) {
      const kind = match[1];
      const body = match[2] ?? '';
      const labels = [...body.matchAll(/"([^"]+)"/g)].map((labelMatch) => labelMatch[1] ?? '');
      labelsByKind.set(kind, labels);
    }

    const positiveLabels = new Set(labelsByKind.get('Positive') ?? []);
    const negativeLabels = labelsByKind.get('Negative') ?? [];

    expect(negativeLabels.filter((label) => positiveLabels.has(label))).toEqual([]);
  });
});
