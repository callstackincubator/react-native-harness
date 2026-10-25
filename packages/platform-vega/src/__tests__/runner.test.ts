import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import {
  DependencyNotFoundError,
  DeviceNotFoundError,
} from '@react-native-harness/platforms';
import type { OwnedProcess } from '@react-native-harness/tools';
import type { VegaPlatformConfigInput } from '../config.js';
import { VegaAppPathError, VegaMetroPortError } from '../errors.js';

const fakeOwnedProcess = (lines: string[] = []): OwnedProcess => {
  const subprocess = Object.assign(Promise.resolve({ stdout: '', stderr: '' }), {
    [Symbol.asyncIterator]: async function* () {
      yield* lines;
    },
  });

  return {
    subprocess: subprocess as unknown as OwnedProcess['subprocess'],
    dispose: vi.fn().mockResolvedValue(undefined),
  };
};

const vega = vi.hoisted(() => ({
  ensureVegaCliAvailable: vi.fn<() => Promise<void>>(),
  findConnectedVirtualDevice: vi.fn<() => Promise<string | null>>(),
  startVirtualDevice: vi.fn<() => Promise<void>>(),
  waitForVirtualDevice: vi.fn<() => Promise<string>>(),
  stopVirtualDevice: vi.fn<() => Promise<void>>(),
  isDeviceConnected: vi.fn<() => Promise<boolean>>(),
  isAppInstalled: vi.fn<() => Promise<boolean>>(),
  installApp: vi.fn<() => Promise<void>>(),
  getAppRunState: vi.fn<() => Promise<'running' | 'stopped' | 'unknown'>>(),
  launchApp: vi.fn<() => Promise<void>>(),
  terminateApp: vi.fn<() => Promise<void>>(),
  startPortForwarding: vi.fn<() => OwnedProcess>(),
  stopPortForwarding: vi.fn<() => Promise<void>>(),
  getVdaBinaryPath: vi.fn<() => Promise<string | null>>(),
  resolveVdaSerial: vi.fn<() => Promise<string>>(),
  vdaReverse: vi.fn<() => Promise<void>>(),
  vdaRemoveReverse: vi.fn<() => Promise<void>>(),
  startLogStream: vi.fn<() => OwnedProcess>(),
  stopLogStream: vi.fn<() => Promise<void>>(),
}));

vi.mock('../vega.js', () => vega);

const harnessConfig = { metroPort: DEFAULT_METRO_PORT } as HarnessConfig;

const virtualConfig: VegaPlatformConfigInput = {
  name: 'vega',
  device: { type: 'emulator', deviceId: 'VirtualDevice' },
  bundleId: 'com.example.app',
};

const physicalConfig: VegaPlatformConfigInput = {
  name: 'fire-tv',
  device: { type: 'physical', serial: 'G0X1AB1234567890' },
  bundleId: 'com.example.app',
};

const init = () => ({ signal: new AbortController().signal });

const loadRunner = async () => (await import('../runner.js')).default;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('HARNESS_APP_PATH', '');
  vega.ensureVegaCliAvailable.mockResolvedValue(undefined);
  vega.findConnectedVirtualDevice.mockResolvedValue('VirtualDevice');
  vega.waitForVirtualDevice.mockResolvedValue('VirtualDevice');
  vega.isDeviceConnected.mockResolvedValue(true);
  vega.isAppInstalled.mockResolvedValue(true);
  vega.getAppRunState.mockResolvedValue('running');
  vega.launchApp.mockResolvedValue(undefined);
  vega.terminateApp.mockResolvedValue(undefined);
  vega.startPortForwarding.mockImplementation(() => fakeOwnedProcess());
  vega.stopPortForwarding.mockResolvedValue(undefined);
  vega.getVdaBinaryPath.mockResolvedValue(null);
  vega.startLogStream.mockImplementation(() => fakeOwnedProcess());
  vega.stopLogStream.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('getVegaRunner', () => {
  it('is invoked with the (config, harnessConfig, init) shape the harness session uses', async () => {
    // The session calls module.default(config, runtimeConfig, init); an
    // optional `init` param would drop out of Function.length and silently
    // break `init.signal`.
    const getVegaRunner = await loadRunner();
    expect(getVegaRunner.length).toBe(3);
  });

  it('throws DependencyNotFoundError when the Vega CLI is missing', async () => {
    vega.ensureVegaCliAvailable.mockRejectedValue(
      new DependencyNotFoundError('vega')
    );
    const getVegaRunner = await loadRunner();

    await expect(
      getVegaRunner(virtualConfig, harnessConfig, init())
    ).rejects.toBeInstanceOf(DependencyNotFoundError);
  });

  it('reuses a running virtual device and leaves it running on dispose', async () => {
    const getVegaRunner = await loadRunner();

    const runner = await getVegaRunner(virtualConfig, harnessConfig, init());
    await runner.dispose();

    expect(vega.startVirtualDevice).not.toHaveBeenCalled();
    expect(vega.stopVirtualDevice).not.toHaveBeenCalled();
  });

  it('starts the virtual device when it is not running and stops it on dispose', async () => {
    vega.findConnectedVirtualDevice.mockResolvedValue(null);
    const getVegaRunner = await loadRunner();

    const runner = await getVegaRunner(virtualConfig, harnessConfig, init());

    expect(vega.startVirtualDevice).toHaveBeenCalledOnce();
    expect(vega.waitForVirtualDevice).toHaveBeenCalledWith(
      'VirtualDevice',
      expect.any(AbortSignal)
    );

    await runner.dispose();
    expect(vega.stopVirtualDevice).toHaveBeenCalledOnce();
  });

  it('stops a virtual device it started when waiting for it fails', async () => {
    vega.findConnectedVirtualDevice.mockResolvedValue(null);
    vega.waitForVirtualDevice.mockRejectedValue(new Error('did not become ready'));
    const getVegaRunner = await loadRunner();

    await expect(
      getVegaRunner(virtualConfig, harnessConfig, init())
    ).rejects.toThrow('did not become ready');
    expect(vega.stopVirtualDevice).toHaveBeenCalledOnce();
  });

  it('stops a virtual device it started when the app setup fails', async () => {
    vega.findConnectedVirtualDevice.mockResolvedValue(null);
    vega.isAppInstalled.mockResolvedValue(false);
    const getVegaRunner = await loadRunner();

    await expect(
      getVegaRunner(virtualConfig, harnessConfig, init())
    ).rejects.toBeInstanceOf(VegaAppPathError);
    expect(vega.stopVirtualDevice).toHaveBeenCalledOnce();
  });

  it('throws DeviceNotFoundError when the physical device is not connected', async () => {
    vega.isDeviceConnected.mockResolvedValue(false);
    const getVegaRunner = await loadRunner();

    await expect(
      getVegaRunner(physicalConfig, harnessConfig, init())
    ).rejects.toBeInstanceOf(DeviceNotFoundError);
    expect(vega.isDeviceConnected).toHaveBeenCalledWith('G0X1AB1234567890');
  });

  it('throws VegaAppPathError when the app is not installed and HARNESS_APP_PATH is unset', async () => {
    vega.isAppInstalled.mockResolvedValue(false);
    const getVegaRunner = await loadRunner();

    await expect(
      getVegaRunner(virtualConfig, harnessConfig, init())
    ).rejects.toBeInstanceOf(VegaAppPathError);
    expect(vega.installApp).not.toHaveBeenCalled();
  });

  it('installs the app from HARNESS_APP_PATH without checking the installed state', async () => {
    const appPath = fileURLToPath(import.meta.url);
    vi.stubEnv('HARNESS_APP_PATH', appPath);
    const getVegaRunner = await loadRunner();

    await getVegaRunner(virtualConfig, harnessConfig, init());

    expect(vega.isAppInstalled).not.toHaveBeenCalled();
    expect(vega.installApp).toHaveBeenCalledWith('VirtualDevice', appPath, {
      signal: expect.any(AbortSignal),
      buildType: 'Debug',
    });
  });

  it('throws VegaAppPathError when HARNESS_APP_PATH points to a missing file', async () => {
    vi.stubEnv('HARNESS_APP_PATH', '/definitely/missing/app.vpkg');
    const getVegaRunner = await loadRunner();

    await expect(
      getVegaRunner(virtualConfig, harnessConfig, init())
    ).rejects.toBeInstanceOf(VegaAppPathError);
  });

  it('launches and terminates the default main component', async () => {
    const getVegaRunner = await loadRunner();

    const runner = await getVegaRunner(virtualConfig, harnessConfig, init());
    const session = await runner.createAppSession();

    expect(vega.launchApp).toHaveBeenCalledWith(
      'VirtualDevice',
      'com.example.app.main'
    );
    expect((await session.getState()).status).toBe('running');

    await session.dispose();
    expect(vega.terminateApp).toHaveBeenCalledWith(
      'VirtualDevice',
      'com.example.app.main'
    );
    expect((await session.getState()).status).toBe('disposed');
  });

  it('honours a custom componentId', async () => {
    const getVegaRunner = await loadRunner();

    const runner = await getVegaRunner(
      { ...virtualConfig, componentId: 'com.example.app.tv' },
      harnessConfig,
      init()
    );
    await runner.createAppSession();

    expect(vega.launchApp).toHaveBeenCalledWith(
      'VirtualDevice',
      'com.example.app.tv'
    );
  });

  it('holds reverse port forwarding for Metro on 8081 until dispose', async () => {
    const forwarding = fakeOwnedProcess();
    vega.startPortForwarding.mockReturnValue(forwarding);
    const getVegaRunner = await loadRunner();

    const runner = await getVegaRunner(virtualConfig, harnessConfig, init());
    expect(vega.startPortForwarding).toHaveBeenCalledWith('VirtualDevice', 8081);
    expect(forwarding.dispose).not.toHaveBeenCalled();

    await runner.dispose();
    expect(forwarding.dispose).toHaveBeenCalledOnce();
    expect(vega.stopPortForwarding).toHaveBeenCalledWith('VirtualDevice', 8081);
  });

  it('throws VegaMetroPortError for a non-8081 Metro port without vda', async () => {
    const getVegaRunner = await loadRunner();

    await expect(
      getVegaRunner(virtualConfig, { metroPort: 8082 } as HarnessConfig, init())
    ).rejects.toBeInstanceOf(VegaMetroPortError);
    expect(vega.startPortForwarding).not.toHaveBeenCalled();
  });

  it('maps device port 8081 to a non-8081 Metro port with vda when available', async () => {
    vega.getVdaBinaryPath.mockResolvedValue('/opt/vega/bin/vda');
    vega.resolveVdaSerial.mockResolvedValue('emulator-5554');
    vega.vdaReverse.mockResolvedValue(undefined);
    vega.vdaRemoveReverse.mockResolvedValue(undefined);
    const getVegaRunner = await loadRunner();

    const runner = await getVegaRunner(
      virtualConfig,
      { metroPort: 8082 } as HarnessConfig,
      init()
    );

    expect(vega.resolveVdaSerial).toHaveBeenCalledWith('VirtualDevice', true);
    expect(vega.vdaReverse).toHaveBeenCalledWith('emulator-5554', 8081, 8082);
    expect(vega.startPortForwarding).not.toHaveBeenCalled();

    await runner.dispose();
    expect(vega.vdaRemoveReverse).toHaveBeenCalledWith('emulator-5554', 8081);
  });

  it('exposes device log lines through getLogs', async () => {
    vega.startLogStream.mockImplementation(() =>
      fakeOwnedProcess(['boot ok', 'app started'])
    );
    const getVegaRunner = await loadRunner();

    const runner = await getVegaRunner(virtualConfig, harnessConfig, init());
    const session = await runner.createAppSession();

    await vi.waitFor(() =>
      expect(session.getLogs().map((entry) => entry.line)).toEqual([
        'boot ok',
        'app started',
      ])
    );
    await session.dispose();
  });

  it('does not stop the app when the init signal aborts after session creation', async () => {
    const getVegaRunner = await loadRunner();
    const controller = new AbortController();

    const runner = await getVegaRunner(virtualConfig, harnessConfig, {
      signal: controller.signal,
    });
    await runner.createAppSession();
    vega.terminateApp.mockClear();

    controller.abort();

    expect(vega.terminateApp).not.toHaveBeenCalled();
    await runner.dispose();
    expect(vega.terminateApp).toHaveBeenCalledOnce();
  });
});
