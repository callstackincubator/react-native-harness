import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_METRO_PORT,
  type Config as HarnessConfig,
} from '@react-native-harness/config';
import { AppNotInstalledError } from '@react-native-harness/platforms';
import type { WindowsPlatformConfigInput } from '../config.js';

const pwsh = vi.hoisted(() => ({
  getPackageFamilyName: vi.fn<() => Promise<string | null>>(),
  isProcessRunning: vi.fn<() => Promise<boolean>>(),
  launchAppByAumid: vi.fn<() => Promise<void>>(),
  stopProcess: vi.fn<() => Promise<void>>(),
}));

vi.mock('../pwsh.js', () => pwsh);

const harnessConfig = { metroPort: DEFAULT_METRO_PORT } as HarnessConfig;

const config: WindowsPlatformConfigInput = {
  name: 'windows',
  packageName: 'ReactNativeNitroExample',
};

const init = () => ({ signal: new AbortController().signal });

afterEach(() => {
  vi.clearAllMocks();
});

const loadRunner = async () => (await import('../runner.js')).default;

describe('getWindowsRunner', () => {
  it('is invoked with the (config, harnessConfig, init) shape the harness session uses', async () => {
    // Same regression guard as the other platform runners: the session calls
    // module.default(config, runtimeConfig, init); an optional `init` param
    // would drop out of Function.length and silently break `init.signal`.
    const getWindowsRunner = await loadRunner();
    expect(getWindowsRunner.length).toBe(3);
  });

  it('throws AppNotInstalledError when the package is not deployed', async () => {
    pwsh.getPackageFamilyName.mockResolvedValue(null);
    const getWindowsRunner = await loadRunner();

    await expect(
      getWindowsRunner(config, harnessConfig, init())
    ).rejects.toBeInstanceOf(AppNotInstalledError);
  });

  it('launches the resolved AUMID and tracks the process', async () => {
    pwsh.getPackageFamilyName.mockResolvedValue('Contoso.Example_1a2b3c');
    pwsh.isProcessRunning.mockResolvedValue(true);
    const getWindowsRunner = await loadRunner();

    const runner = await getWindowsRunner(config, harnessConfig, init());
    const session = await runner.createAppSession();

    // A stale instance is cleared before launch, then the app is shell-activated.
    expect(pwsh.stopProcess).toHaveBeenCalledWith('ReactNativeNitroExample');
    expect(pwsh.launchAppByAumid).toHaveBeenCalledWith(
      'Contoso.Example_1a2b3c!App'
    );
    expect((await session.getState()).status).toBe('running');

    await session.dispose();
    expect((await session.getState()).status).toBe('disposed');
  });

  it('honours a custom appId and processName', async () => {
    pwsh.getPackageFamilyName.mockResolvedValue('Contoso.Example_1a2b3c');
    pwsh.isProcessRunning.mockResolvedValue(true);
    const getWindowsRunner = await loadRunner();

    const runner = await getWindowsRunner(
      { ...config, appId: 'MyApp', processName: 'Example' },
      harnessConfig,
      init()
    );
    await runner.createAppSession();

    expect(pwsh.launchAppByAumid).toHaveBeenCalledWith(
      'Contoso.Example_1a2b3c!MyApp'
    );
    expect(pwsh.stopProcess).toHaveBeenCalledWith('Example');
  });

  it('throws if the process never starts after launch', async () => {
    vi.useFakeTimers();
    try {
      pwsh.getPackageFamilyName.mockResolvedValue('Contoso.Example_1a2b3c');
      pwsh.isProcessRunning.mockResolvedValue(false);
      const getWindowsRunner = await loadRunner();

      const runner = await getWindowsRunner(config, harnessConfig, init());

      // Attach the rejection handler before advancing timers so the promise is
      // never momentarily unhandled, then flush the fixed number of start-poll
      // delays without waiting in real time.
      const assertion = expect(runner.createAppSession()).rejects.toThrow(
        /did not start/
      );
      await vi.advanceTimersByTimeAsync(15 * 400);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits app_exited and reports the exited state when the process disappears', async () => {
    pwsh.getPackageFamilyName.mockResolvedValue('Contoso.Example_1a2b3c');
    // Up for the startup check, gone by the first poll iteration (which runs
    // before any delay), so this settles without waiting on the poll timer.
    pwsh.isProcessRunning.mockResolvedValueOnce(true).mockResolvedValue(false);
    const getWindowsRunner = await loadRunner();

    const runner = await getWindowsRunner(config, harnessConfig, init());
    const session = await runner.createAppSession();

    await vi.waitFor(async () =>
      expect((await session.getState()).status).toBe('exited')
    );
  });

  it('does not stop the app when the init signal aborts after session creation', async () => {
    pwsh.getPackageFamilyName.mockResolvedValue('Contoso.Example_1a2b3c');
    pwsh.isProcessRunning.mockResolvedValue(true);
    const getWindowsRunner = await loadRunner();

    const controller = new AbortController();
    const runner = await getWindowsRunner(config, harnessConfig, {
      signal: controller.signal,
    });
    await runner.createAppSession();
    pwsh.stopProcess.mockClear();

    controller.abort();

    expect(pwsh.stopProcess).not.toHaveBeenCalled();
  });
});
