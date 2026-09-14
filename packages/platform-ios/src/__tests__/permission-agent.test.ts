import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  createAgentDeviceClient: vi.fn(),
  alert: vi.fn(),
  press: vi.fn(),
  prepare: vi.fn(),
  open: vi.fn(),
  closeSession: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock('agent-device', () => ({
  createAgentDeviceClient: mocks.createAgentDeviceClient,
}));

vi.mock('@react-native-harness/tools', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@react-native-harness/tools')>();

  return { ...actual, runCommand: mocks.runCommand };
});

const {
  assertSupportedNodeVersion,
  buildLabelSelector,
  copyAgentDeviceLogs,
  createIosPermissionAgent,
  getAgentDeviceStateDir,
  getPermissionWatchdogIntervalMs,
  getPrepareTimeoutMs,
} = await import('../permission-agent.js');

const createAgentDeviceError = (
  code: string,
  message: string,
  details?: Record<string, unknown>
) => Object.assign(new Error(message), { code, details });

const alertNotFoundError = () =>
  createAgentDeviceError('COMMAND_FAILED', 'alert not found', {
    runnerErrorCode: 'ALERT_NOT_FOUND',
  });

let projectRoot: string;
let homeDir: string;

const createAgent = (
  overrides: Partial<Parameters<typeof createIosPermissionAgent>[0]> = {}
) =>
  createIosPermissionAgent({
    appBundleId: 'com.harnessplayground',
    target: { kind: 'simulator', udid: 'sim-udid' },
    projectRoot,
    ...overrides,
  });

describe('iOS permission agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-project-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-home-'));
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    // Keep the watchdog fast; the default is one second between calls.
    vi.stubEnv('HARNESS_PERMISSION_WATCHDOG_INTERVAL_MS', '1');
    vi.stubEnv('HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS', '');
    vi.stubEnv('HARNESS_IOS_XCTESTRUN_FILE', '');
    vi.stubEnv('HARNESS_IOS_XCTEST_DERIVED_DATA_PATH', '');
    vi.stubEnv('AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH', '');
    vi.stubEnv('AGENT_DEVICE_IOS_TEAM_ID', '');
    vi.stubEnv('AGENT_DEVICE_IOS_SIGNING_IDENTITY', '');
    vi.stubEnv('AGENT_DEVICE_IOS_PROVISIONING_PROFILE', '');
    vi.stubEnv('AGENT_DEVICE_IOS_BUNDLE_ID', '');

    mocks.prepare.mockResolvedValue({});
    mocks.open.mockResolvedValue({});
    mocks.alert.mockRejectedValue(alertNotFoundError());
    mocks.press.mockResolvedValue({});
    mocks.closeSession.mockResolvedValue({});
    mocks.runCommand.mockResolvedValue({ stdout: '', stderr: '' });
    mocks.createAgentDeviceClient.mockReturnValue({
      command: { alert: mocks.alert, prepare: mocks.prepare },
      apps: { open: mocks.open },
      sessions: { close: mocks.closeSession },
      interactions: { press: mocks.press },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('creates the client against a Harness-owned state dir and prepares the iOS runner', async () => {
    const agent = createAgent();

    await agent.prepare();

    const stateDir = getAgentDeviceStateDir(projectRoot);
    expect(stateDir.startsWith(path.join(homeDir, '.agent-device', 'harness')))
      .toBe(true);
    expect(mocks.createAgentDeviceClient).toHaveBeenCalledWith(
      expect.objectContaining({ stateDir, session: 'harness' })
    );
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ios-runner',
        platform: 'ios',
        udid: 'sim-udid',
      })
    );
    expect(process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH).toBe(
      path.join(projectRoot, '.harness', 'cache', 'agent-device-runner')
    );
    // Bound to SpringBoard, never to the app under test: `press` refuses to
    // run without an open session, and Harness still owns the app lifecycle.
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        app: 'com.apple.springboard',
        platform: 'ios',
        udid: 'sim-udid',
      })
    );

    await agent.dispose();
  });

  it('leaves a user-provided runner derived path untouched', async () => {
    vi.stubEnv('AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH', '/custom/derived');

    const agent = createAgent();
    await agent.prepare();

    expect(process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH).toBe(
      '/custom/derived'
    );

    await agent.dispose();
  });

  it('does not poll while the app under test is not running', async () => {
    const agent = createAgent();
    await agent.prepare();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.alert).not.toHaveBeenCalled();

    agent.setAppRunning(true);
    await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalled());

    agent.setAppRunning(false);
    const callsWhileStopped = mocks.alert.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.alert.mock.calls.length).toBeLessThanOrEqual(
      callsWhileStopped + 1
    );

    await agent.dispose();
  });

  it('taps the first known positive button on a prompt', async () => {
    mocks.alert.mockResolvedValue({
      message: 'Allow “Playground” to use your location?',
      items: ['Allow Once', 'Allow While Using App', 'Don’t Allow'],
    });

    const agent = createAgent();
    await agent.prepare();
    agent.setAppRunning(true);

    await vi.waitFor(() => expect(mocks.press).toHaveBeenCalled());

    expect(mocks.press).toHaveBeenCalledWith({
      platform: 'ios',
      udid: 'sim-udid',
      selector: 'label="Allow Once"',
    });

    await agent.dispose();
  });

  it('never taps a negative button', async () => {
    mocks.alert.mockResolvedValue({
      message: 'Delete everything?',
      items: ['Don’t Allow', 'Cancel'],
    });

    const agent = createAgent();
    await agent.prepare();
    agent.setAppRunning(true);

    await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(mocks.press).not.toHaveBeenCalled();

    await agent.dispose();
  });

  it.each([
    ['ALERT_NOT_FOUND', alertNotFoundError()],
    [
      'RUNNER_BUSY',
      createAgentDeviceError('RUNNER_BUSY', 'The iOS runner is still busy'),
    ],
    [
      'a timeout',
      createAgentDeviceError('COMMAND_FAILED', 'main thread execution timed out'),
    ],
  ])('treats %s as transient and keeps polling', async (_label, error) => {
    mocks.alert.mockRejectedValue(error);

    const agent = createAgent();
    await agent.prepare();
    agent.setAppRunning(true);

    await vi.waitFor(() =>
      expect(mocks.alert.mock.calls.length).toBeGreaterThan(1)
    );
    expect(mocks.press).not.toHaveBeenCalled();

    await agent.dispose();
  });

  it('forwards external xctestrun artifacts to the client', async () => {
    const xctestrunFile = path.join(projectRoot, 'Runner.xctestrun');
    const derivedDataPath = path.join(projectRoot, 'DerivedData');
    fs.writeFileSync(xctestrunFile, '');
    fs.mkdirSync(derivedDataPath);
    vi.stubEnv('HARNESS_IOS_XCTESTRUN_FILE', xctestrunFile);
    vi.stubEnv('HARNESS_IOS_XCTEST_DERIVED_DATA_PATH', derivedDataPath);

    const agent = createAgent();
    await agent.prepare();

    expect(mocks.createAgentDeviceClient).toHaveBeenCalledWith(
      expect.objectContaining({
        iosXctestrunFile: xctestrunFile,
        iosXctestDerivedDataPath: derivedDataPath,
      })
    );

    await agent.dispose();
  });

  it('fails when an external xctestrun artifact is missing', async () => {
    vi.stubEnv('HARNESS_IOS_XCTESTRUN_FILE', path.join(projectRoot, 'nope'));

    const agent = createAgent();

    await expect(agent.prepare()).rejects.toThrow(
      'HARNESS_IOS_XCTESTRUN_FILE'
    );

    await agent.dispose();
  });

  it('maps physical device code signing onto the daemon environment', async () => {
    const agent = createAgent({
      target: {
        kind: 'device',
        udid: 'device-udid',
        codeSign: {
          teamId: 'TEAMID1234',
          signingIdentity: 'Apple Development: Someone',
          provisioningProfile: 'Harness Profile',
          runnerBundleId: 'com.example.runner',
        },
      },
    });

    await agent.prepare();

    expect(process.env.AGENT_DEVICE_IOS_TEAM_ID).toBe('TEAMID1234');
    expect(process.env.AGENT_DEVICE_IOS_SIGNING_IDENTITY).toBe(
      'Apple Development: Someone'
    );
    expect(process.env.AGENT_DEVICE_IOS_PROVISIONING_PROFILE).toBe(
      'Harness Profile'
    );
    expect(process.env.AGENT_DEVICE_IOS_BUNDLE_ID).toBe('com.example.runner');

    await agent.dispose();
  });

  it('stops the daemon with --clean and copies the agent-device logs on dispose', async () => {
    const agent = createAgent();
    await agent.prepare();

    const stateDir = getAgentDeviceStateDir(projectRoot);
    const sessionDir = path.join(stateDir, 'sessions', 'cwd_abc_harness');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'daemon.log'), 'daemon output');
    fs.writeFileSync(path.join(sessionDir, 'runner.log'), 'runner output');

    await agent.dispose();

    expect(mocks.runCommand).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        'daemon',
        'stop',
        '--state-dir',
        stateDir,
        '--clean',
        '--json',
      ]),
      expect.anything()
    );

    const logsRoot = path.join(projectRoot, '.harness', 'logs');
    const runDirectories = fs.readdirSync(logsRoot);
    expect(runDirectories).toHaveLength(1);

    const runDirectory = path.join(logsRoot, runDirectories[0] as string);
    expect(fs.readFileSync(path.join(runDirectory, 'daemon.log'), 'utf8')).toBe(
      'daemon output'
    );
    expect(fs.readFileSync(path.join(runDirectory, 'runner.log'), 'utf8')).toBe(
      'runner output'
    );
  });

  it('surfaces DEVICE_IN_USE verbatim with its hint and does not retry', async () => {
    mocks.prepare.mockRejectedValue(
      createAgentDeviceError(
        'DEVICE_IN_USE',
        'ios device sim-udid is owned by session "ios" in workspace "/other".',
        { hint: 'Close the other session first.' }
      )
    );

    const agent = createAgent();

    await expect(agent.prepare()).rejects.toThrow(
      /is owned by session "ios" in workspace "\/other"\./
    );
    await expect(agent.prepare()).rejects.toThrow(
      /Close the other session first\./
    );

    // One attempt per prepare() call: the claim is never retried internally.
    expect(mocks.prepare).toHaveBeenCalledTimes(2);

    await agent.dispose();
  });

  it('never overlaps two runner commands', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.alert.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inFlight -= 1;
      throw alertNotFoundError();
    });

    const agent = createAgent();
    await agent.prepare();
    agent.setAppRunning(true);

    await vi.waitFor(() =>
      expect(mocks.alert.mock.calls.length).toBeGreaterThan(2)
    );

    expect(maxInFlight).toBe(1);

    await agent.dispose();
  });

  it('stops the daemon without waiting out an in-flight poll', async () => {
    mocks.alert.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(alertNotFoundError()), 5000);
        })
    );

    const agent = createAgent();
    await agent.prepare();
    agent.setAppRunning(true);

    await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalled());

    const startedAt = Date.now();
    await agent.dispose();
    const elapsed = Date.now() - startedAt;

    // The daemon stop runs immediately; only the bounded drain is waited on,
    // never the poll's own 20 s budget.
    expect(mocks.runCommand).toHaveBeenCalled();
    expect(elapsed).toBeLessThan(4000);
  });

  it('gives up after three consecutive unclassified failures', async () => {
    mocks.alert.mockRejectedValue(
      createAgentDeviceError('RUNNER_CRASHED', 'the runner exited', {
        hint: 'Check runner.log.',
      })
    );

    const agent = createAgent();
    await agent.prepare();
    agent.setAppRunning(true);

    await vi.waitFor(() =>
      expect(mocks.alert.mock.calls.length).toBe(3)
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The loop is gone; no fourth attempt is ever made.
    expect(mocks.alert.mock.calls.length).toBe(3);

    await agent.dispose();
  });

  it('taps a padded label using its trimmed form', async () => {
    mocks.alert.mockResolvedValue({
      message: 'Allow access?',
      items: ['  Allow  ', 'Don’t Allow'],
    });

    const agent = createAgent();
    await agent.prepare();
    agent.setAppRunning(true);

    await vi.waitFor(() => expect(mocks.press).toHaveBeenCalled());

    expect(mocks.press).toHaveBeenCalledWith(
      expect.objectContaining({ selector: 'label="Allow"' })
    );

    await agent.dispose();
  });

  it('refuses to build a selector for a label with a quote or backslash', () => {
    expect(buildLabelSelector('Allow')).toBe('label="Allow"');
    expect(buildLabelSelector('Allow "Maps"')).toBeUndefined();
    expect(buildLabelSelector('Allow\\Once')).toBeUndefined();
  });

  it('derives the prepare budget from platformReadyTimeout', () => {
    expect(getPrepareTimeoutMs(undefined)).toBe(240_000);
    expect(getPrepareTimeoutMs(300_000)).toBe(240_000);
    expect(getPrepareTimeoutMs(600_000)).toBe(480_000);
    // Never collapses to something unusably small.
    expect(getPrepareTimeoutMs(1_000)).toBe(30_000);
  });

  it('keeps user-provided signing environment variables', async () => {
    vi.stubEnv('AGENT_DEVICE_IOS_TEAM_ID', 'USERTEAM99');

    const agent = createAgent({
      target: {
        kind: 'device',
        udid: 'device-udid',
        codeSign: { teamId: 'TEAMID1234' },
      },
    });

    await agent.prepare();

    expect(process.env.AGENT_DEVICE_IOS_TEAM_ID).toBe('USERTEAM99');

    await agent.dispose();
  });

  it('rejects Node versions below the agent-device floor', () => {
    expect(() => assertSupportedNodeVersion('22.11.0')).toThrow(
      /requires Node\.js 22\.12 or newer/
    );
    expect(() => assertSupportedNodeVersion('20.19.0')).toThrow(
      /requires Node\.js 22\.12 or newer/
    );
    expect(() => assertSupportedNodeVersion('22.12.0')).not.toThrow();
    expect(() => assertSupportedNodeVersion('24.1.0')).not.toThrow();
    // A newer major qualifies whatever its minor is.
    expect(() => assertSupportedNodeVersion('24.0.0')).not.toThrow();
    expect(() => assertSupportedNodeVersion('23')).not.toThrow();
  });

  it('reads the watchdog interval from either environment variable', () => {
    vi.stubEnv('HARNESS_PERMISSION_WATCHDOG_INTERVAL_MS', '');
    vi.stubEnv('HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS', '');
    expect(getPermissionWatchdogIntervalMs()).toBe(1000);

    vi.stubEnv('HARNESS_XCTEST_AGENT_TICK_INTERVAL_MS', '250');
    expect(getPermissionWatchdogIntervalMs()).toBe(250);

    vi.stubEnv('HARNESS_PERMISSION_WATCHDOG_INTERVAL_MS', '500');
    expect(getPermissionWatchdogIntervalMs()).toBe(500);
  });

  it('tolerates a state dir without any logs', () => {
    const stateDir = path.join(projectRoot, 'empty-state');
    const targetDirectory = path.join(projectRoot, 'logs-out');
    fs.mkdirSync(stateDir);
    fs.mkdirSync(targetDirectory);

    expect(copyAgentDeviceLogs({ stateDir, targetDirectory })).toEqual([]);
  });
});
