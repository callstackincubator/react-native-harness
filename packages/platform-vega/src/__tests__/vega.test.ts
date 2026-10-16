import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { SubprocessError } from '@react-native-harness/tools';

const mocks = vi.hoisted(() => ({
  runCommand:
    vi.fn<
      (
        file: string,
        args: readonly string[],
        options?: unknown
      ) => Promise<{ stdout: string; stderr: string }>
    >(),
  existsSync: vi.fn<(file: string) => boolean>(),
  homedir: vi.fn<() => string>(),
}));

vi.mock('@react-native-harness/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-native-harness/tools')>()),
  runCommand: mocks.runCommand,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: { ...actual, existsSync: mocks.existsSync },
    existsSync: mocks.existsSync,
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    default: { ...actual, homedir: mocks.homedir },
    homedir: mocks.homedir,
  };
});

const vega = await import('../vega.js');

beforeEach(() => {
  vega.resetVegaBinaryCache();
  vi.stubEnv('PATH', '/usr/bin');
  vi.stubEnv('KEPLER_SDK_PATH', '');
  vi.stubEnv('VEGA_CLI_PATH', '');
  mocks.homedir.mockReturnValue('/home/dev');
  mocks.existsSync.mockReturnValue(false);
  mocks.runCommand.mockResolvedValue({ stdout: '', stderr: '' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('parseDeviceList', () => {
  it('parses virtual and physical device lines', () => {
    const entries = vega.parseDeviceList(
      [
        'Connected devices:',
        'G0X1AB1234567890 : A1ZZ32RVTQ796E',
        'VirtualDevice : tv - x86_64 - OS - amazon-ab123456cd789012',
        '',
      ].join('\n')
    );

    expect(entries).toEqual([
      {
        id: 'G0X1AB1234567890',
        description: 'A1ZZ32RVTQ796E',
        isVirtual: false,
      },
      {
        id: 'VirtualDevice',
        description: 'tv - x86_64 - OS - amazon-ab123456cd789012',
        isVirtual: true,
      },
    ]);
  });

  it('recognises a virtual device listed under its serial', () => {
    const entries = vega.parseDeviceList(
      'amazon-d82a77d000723901 : Vega Virtual Device - tv - aarch64'
    );

    expect(entries[0]?.isVirtual).toBe(true);
  });
});

describe('resolveVegaBinary', () => {
  it('prefers VEGA_CLI_PATH', () => {
    vi.stubEnv('VEGA_CLI_PATH', '/custom/vega');

    expect(vega.resolveVegaBinary()).toBe('/custom/vega');
    expect(mocks.existsSync).not.toHaveBeenCalled();
  });

  it('finds vega on PATH before the legacy kepler name', () => {
    mocks.existsSync.mockImplementation(
      (file) => file === path.join('/usr/bin', 'vega') || file === path.join('/usr/bin', 'kepler')
    );

    expect(vega.resolveVegaBinary()).toBe(path.join('/usr/bin', 'vega'));
  });

  it('falls back to KEPLER_SDK_PATH and the default SDK location', () => {
    vi.stubEnv('KEPLER_SDK_PATH', '/opt/vega-sdk');
    mocks.existsSync.mockImplementation(
      (file) => file === path.join('/opt/vega-sdk', 'bin', 'kepler')
    );
    expect(vega.resolveVegaBinary()).toBe(
      path.join('/opt/vega-sdk', 'bin', 'kepler')
    );

    vega.resetVegaBinaryCache();
    vi.stubEnv('KEPLER_SDK_PATH', '');
    mocks.existsSync.mockImplementation(
      (file) => file === path.join('/home/dev', 'vega', 'bin', 'vega')
    );
    expect(vega.resolveVegaBinary()).toBe(
      path.join('/home/dev', 'vega', 'bin', 'vega')
    );
  });

  it('returns null when nothing is installed', () => {
    expect(vega.resolveVegaBinary()).toBeNull();
  });
});

describe('commands', () => {
  beforeEach(() => {
    vi.stubEnv('VEGA_CLI_PATH', '/opt/vega/bin/vega');
  });

  it('rejects with DependencyNotFoundError when the CLI is missing', async () => {
    vi.stubEnv('VEGA_CLI_PATH', '');

    await expect(vega.ensureVegaCliAvailable()).rejects.toThrow(
      /Dependency "vega" not found/
    );
  });

  it('reports a connected device', async () => {
    mocks.runCommand.mockResolvedValue({
      stdout: 'Device VirtualDevice is connected',
      stderr: '',
    });

    await expect(vega.isDeviceConnected('VirtualDevice')).resolves.toBe(true);
    expect(mocks.runCommand).toHaveBeenCalledWith(
      '/opt/vega/bin/vega',
      ['device', 'is-connected', '--device', 'VirtualDevice'],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  it('ignores stderr when reading the connection state', async () => {
    mocks.runCommand.mockResolvedValueOnce({
      stdout: 'Device VirtualDevice is connected',
      stderr: 'warn: previous device is not connected',
    });

    await expect(vega.isDeviceConnected('VirtualDevice')).resolves.toBe(true);
  });

  it('gives up waiting for the virtual device after the timeout', async () => {
    mocks.runCommand.mockResolvedValue({ stdout: '', stderr: '' });

    await expect(
      vega.waitForVirtualDevice('VirtualDevice', new AbortController().signal, {
        pollIntervalMs: 1,
        timeoutMs: 20,
      })
    ).rejects.toThrow(/did not become ready within 20 ms/);
  });

  it('parses vda device serials', () => {
    expect(
      vega.parseVdaDevices(
        'List of devices attached\nemulator-5554\tdevice\nG0X1AB1234567890\toffline\n\n'
      )
    ).toEqual(['emulator-5554']);
  });

  it('resolves the vda serial for the target device', async () => {
    const devices = (...serials: string[]) => ({
      stdout: ['List of devices attached', ...serials.map((s) => `${s}\tdevice`)].join('\n'),
      stderr: '',
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.runCommand.mockImplementation(async (_file, args) => {
      if (args[0] === 'which') return { stdout: '/sdk/vda', stderr: '' };
      return devices('emulator-5554', 'G0X1AB1234567890');
    });

    await expect(vega.resolveVdaSerial('G0X1AB1234567890', false)).resolves.toBe(
      'G0X1AB1234567890'
    );
    await expect(vega.resolveVdaSerial('VirtualDevice', true)).resolves.toBe(
      'emulator-5554'
    );
    await expect(vega.resolveVdaSerial('OTHER', false)).rejects.toThrow(
      /Could not tell which vda device/
    );

    mocks.runCommand.mockImplementation(async (_file, args) => {
      if (args[0] === 'which') return { stdout: '/sdk/vda', stderr: '' };
      return devices('emulator-5554');
    });
    await expect(vega.resolveVdaSerial('G0X1AB1234567890', false)).resolves.toBe(
      'emulator-5554'
    );
  });

  it('reports a disconnected device from a non-zero exit or a negative message', async () => {
    mocks.runCommand.mockRejectedValueOnce(new Error('exit 1'));
    await expect(vega.isDeviceConnected('VirtualDevice')).resolves.toBe(false);

    mocks.runCommand.mockResolvedValueOnce({
      stdout: 'Device VirtualDevice is not connected',
      stderr: '',
    });
    await expect(vega.isDeviceConnected('VirtualDevice')).resolves.toBe(false);
  });

  it('reports unknown when the running probe fails instead of claiming the app stopped', async () => {
    mocks.runCommand.mockRejectedValueOnce(new Error('exit 1'));
    await expect(
      vega.getAppRunState('VirtualDevice', 'com.example.app.main')
    ).resolves.toBe('unknown');

    mocks.runCommand.mockResolvedValueOnce({
      stdout: 'com.example.app.main is not running on VirtualDevice',
      stderr: '',
    });
    await expect(
      vega.getAppRunState('VirtualDevice', 'com.example.app.main')
    ).resolves.toBe('stopped');

    mocks.runCommand.mockResolvedValueOnce({
      stdout: 'com.example.app.main is running on VirtualDevice',
      stderr: '',
    });
    await expect(
      vega.getAppRunState('VirtualDevice', 'com.example.app.main')
    ).resolves.toBe('running');
  });

  it('treats a false answer from is-app-installed as not installed', async () => {
    mocks.runCommand.mockResolvedValueOnce({ stdout: 'false', stderr: '' });
    await expect(
      vega.isAppInstalled('VirtualDevice', 'com.example.app.main')
    ).resolves.toBe(false);

    mocks.runCommand.mockResolvedValueOnce({ stdout: 'true', stderr: '' });
    await expect(
      vega.isAppInstalled('VirtualDevice', 'com.example.app.main')
    ).resolves.toBe(true);
  });

  it('installs a package with the device and package path flags', async () => {
    await vega.installApp('VirtualDevice', '/tmp/app.vpkg', {
      signal: new AbortController().signal,
      buildType: 'Debug',
    });

    expect(mocks.runCommand).toHaveBeenCalledWith(
      '/opt/vega/bin/vega',
      [
        'device',
        'install-app',
        '--device',
        'VirtualDevice',
        '--packagePath',
        '/tmp/app.vpkg',
        '--buildType',
        'Debug',
      ],
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('locates vda through the CLI before scanning bin directories', async () => {
    mocks.existsSync.mockImplementation((file) => file === '/sdk/workspace/vda');
    mocks.runCommand.mockResolvedValueOnce({
      stdout: 'Active SDK Version: 0.24\n/sdk/workspace/vda\n',
      stderr: '',
    });

    await expect(vega.getVdaBinaryPath()).resolves.toBe('/sdk/workspace/vda');
    expect(mocks.runCommand).toHaveBeenCalledWith(
      '/opt/vega/bin/vega',
      ['which', 'vda'],
      expect.anything()
    );
  });

  it('finds a connected virtual device by its preferred name or as the only virtual entry', async () => {
    mocks.runCommand.mockResolvedValue({
      stdout: 'amazon-1234 : Vega Virtual Device - tv - aarch64',
      stderr: '',
    });

    await expect(vega.findConnectedVirtualDevice('VirtualDevice')).resolves.toBe(
      'amazon-1234'
    );
  });

  it('waits for the virtual device until it accepts package manager commands repeatedly', async () => {
    const installedAppsCalls = () =>
      mocks.runCommand.mock.calls.filter(([, args]) =>
        args.includes('installed-apps')
      ).length;
    mocks.runCommand.mockImplementation(async (_file, args) => {
      const command = args.join(' ');
      if (command.startsWith('device list')) {
        return { stdout: 'VirtualDevice : tv - aarch64 - OS - amazon-1', stderr: '' };
      }
      if (command.startsWith('device is-connected')) {
        return { stdout: 'Device VirtualDevice is connected', stderr: '' };
      }
      if (command.startsWith('device installed-apps')) {
        // Two failures, then it must answer three times in a row.
        if (installedAppsCalls() <= 2) {
          throw new Error('package manager not ready');
        }
        return { stdout: 'com.example.app.main', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    await expect(
      vega.waitForVirtualDevice('VirtualDevice', new AbortController().signal, {
        pollIntervalMs: 1,
      })
    ).resolves.toBe('VirtualDevice');
    expect(installedAppsCalls()).toBe(5);
  });

  it('retries a failed install and reports the CLI error after the last attempt', async () => {
    const failure = Object.assign(new SubprocessError('Command failed'), {
      stderr: 'error: device offline (transport offline)',
    });
    mocks.runCommand.mockRejectedValueOnce(failure).mockResolvedValueOnce({
      stdout: 'Installing ...success',
      stderr: '',
    });

    await expect(
      vega.installApp('VirtualDevice', '/tmp/app.vpkg', {
        signal: new AbortController().signal,
        buildType: 'Debug',
        retryDelayMs: 1,
      })
    ).resolves.toBeUndefined();
    expect(mocks.runCommand).toHaveBeenCalledTimes(2);

    mocks.runCommand.mockRejectedValue(failure);
    await expect(
      vega.installApp('VirtualDevice', '/tmp/app.vpkg', {
        signal: new AbortController().signal,
        buildType: 'Debug',
        attempts: 2,
        retryDelayMs: 1,
      })
    ).rejects.toThrow(/failed after 2 attempt\(s\): error: device offline/);
  });

  it('waits for the virtual device until the signal aborts', async () => {
    mocks.runCommand.mockResolvedValue({ stdout: '', stderr: '' });
    const controller = new AbortController();
    const waiting = vega.waitForVirtualDevice('VirtualDevice', controller.signal, {
      pollIntervalMs: 1,
    });
    const assertion = expect(waiting).rejects.toThrow(/aborted/i);

    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort(new Error('aborted'));
    await assertion;
  });
});
