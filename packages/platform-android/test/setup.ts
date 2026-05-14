import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import type { ChildProcessByStdio } from 'node:child_process';

const createMockChildProcess = (): ChildProcessByStdio<
  null,
  PassThrough,
  PassThrough
> => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  return {
    stdout,
    stderr,
    unref: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
};

const createMockSubprocess = () => ({
  nodeChildProcess: Promise.resolve({
    kill: vi.fn(),
  }),
  [Symbol.asyncIterator]: async function* () {
    yield* [];
  },
});

vi.mock('../src/adb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/adb.js')>();

  return {
    ...actual,
    emulatorProcess: {
      startDetachedProcess: vi.fn(createMockChildProcess),
    },
    verifyAndroidEmulatorSdk: vi.fn().mockResolvedValue(undefined),
    isAppInstalled: vi.fn().mockResolvedValue(true),
    reversePort: vi.fn().mockResolvedValue(undefined),
    stopApp: vi.fn().mockResolvedValue(undefined),
    startApp: vi.fn().mockResolvedValue(undefined),
    getDeviceIds: vi.fn().mockResolvedValue([]),
    getEmulatorName: vi.fn().mockResolvedValue(''),
    getShellProperty: vi.fn().mockResolvedValue(''),
    getDeviceInfo: vi.fn().mockResolvedValue(null),
    isBootCompleted: vi.fn().mockResolvedValue(true),
    stopEmulator: vi.fn().mockResolvedValue(undefined),
    installApp: vi.fn().mockResolvedValue(undefined),
    uninstallApp: vi.fn().mockResolvedValue(undefined),
    hasAvd: vi.fn().mockResolvedValue(false),
    createAvd: vi.fn().mockResolvedValue(undefined),
    deleteAvd: vi.fn().mockResolvedValue(undefined),
    startEmulator: vi.fn().mockResolvedValue(undefined),
    waitForEmulator: vi.fn().mockResolvedValue('emulator-5554'),
    waitForEmulatorDisconnect: vi.fn().mockResolvedValue(undefined),
    waitForBoot: vi.fn().mockResolvedValue('emulator-5554'),
    isAppRunning: vi.fn().mockResolvedValue(false),
    getAppUid: vi.fn().mockResolvedValue(0),
    setHideErrorDialogs: vi.fn().mockResolvedValue(undefined),
    getLogcatTimestamp: vi.fn().mockResolvedValue('01-01 00:00:00.000'),
    startLogcat: vi.fn(createMockSubprocess),
    getAvds: vi.fn().mockResolvedValue([]),
    getConnectedDevices: vi.fn().mockResolvedValue([]),
    grantPermissions: vi.fn().mockResolvedValue(undefined),
  };
});
