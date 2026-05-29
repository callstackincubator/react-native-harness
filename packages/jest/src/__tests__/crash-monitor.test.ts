import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type {
  AppSession,
  AppSessionEvent,
  AppSessionListener,
  AppSessionLog,
  AppSessionState,
} from '@react-native-harness/platforms';
import {
  createCrashMonitor,
  CrashWatchCancelledError,
} from '../crash-monitor.js';
import { NativeCrashError, RuntimeDisconnectError } from '../errors.js';

const noop = () => undefined;
const waitForClassification = () =>
  new Promise((resolve) => setTimeout(resolve, 1600));

const createAppSessionMock = (
  initialState: AppSessionState = { status: 'running' },
  logs: AppSessionLog[] = [],
  getCrashDetails?: AppSession['getCrashDetails']
) => {
  let state = initialState;
  let listener: AppSessionListener | null = null;

  const session: AppSession = {
    dispose: vi.fn(async () => undefined),
    getState: vi.fn(async () => state),
    getLogs: vi.fn(() => logs),
    addListener: vi.fn((l: AppSessionListener) => {
      listener = l;
    }),
    removeListener: vi.fn((l: AppSessionListener) => {
      if (listener === l) listener = null;
    }),
  };

  if (getCrashDetails) {
    session.getCrashDetails = getCrashDetails;
  }

  return {
    session,
    setState: (nextState: AppSessionState) => {
      state = nextState;
    },
    emit: (event: AppSessionEvent) => listener?.(event),
  };
};

describe('createCrashMonitor', () => {
  it('starts not alive and becomes alive when an app session is attached', () => {
    const cm = createCrashMonitor();
    const { session } = createAppSessionMock();

    expect(cm.isAlive()).toBe(false);

    cm.setAppSession(session);

    expect(cm.isAlive()).toBe(true);
  });

  it('rejects a watch with NativeCrashError when the app session exits', async () => {
    const { session, emit } = createAppSessionMock({
      status: 'exited',
      occurredAt: Date.now(),
      reason: 'observed-exit',
    });
    const cm = createCrashMonitor({ appSession: session });
    const watch = cm.watch('/test/example.ts', 'execution');
    watch.promise.catch(noop);

    emit({ type: 'app_exited' });

    const error = await watch.promise.catch((err: NativeCrashError) => err);
    expect(error).toBeInstanceOf(NativeCrashError);
    expect(error.testFilePath).toBe('/test/example.ts');
    expect(error.details.phase).toBe('execution');
    expect(cm.isAlive()).toBe(false);
  });

  it('classifies bridge disconnect plus exited app as NativeCrashError', async () => {
    const { session, setState } = createAppSessionMock();
    const cm = createCrashMonitor({ appSession: session });
    const watch = cm.watch('test.ts', 'execution');
    watch.promise.catch(noop);

    cm.handleBridgeDisconnect();
    setState({
      status: 'exited',
      occurredAt: Date.now(),
      reason: 'process-gone',
    });

    await expect(watch.promise).rejects.toBeInstanceOf(NativeCrashError);
  });

  it('classifies bridge disconnect plus running app as RuntimeDisconnectError', async () => {
    const { session } = createAppSessionMock({ status: 'running' });
    const cm = createCrashMonitor({ appSession: session });
    const watch = cm.watch('test.ts', 'execution');
    watch.promise.catch(noop);

    cm.handleBridgeDisconnect();

    await expect(watch.promise).rejects.toBeInstanceOf(RuntimeDisconnectError);
  });

  it('attaches matching session log evidence to native crash details', async () => {
    const occurredAt = Date.now();
    const logs = [
      { line: 'ordinary app log', occurredAt },
      { line: 'MyApp[123] fatal error: boom', occurredAt },
    ];
    const { session, setState } = createAppSessionMock(
      { status: 'running' },
      logs
    );
    const cm = createCrashMonitor({ appSession: session });
    const watch = cm.watch('test.ts', 'execution');
    watch.promise.catch(noop);

    cm.handleBridgeDisconnect();
    setState({ status: 'exited', occurredAt, reason: 'process-gone' });

    const error = await watch.promise.catch((err: NativeCrashError) => err);
    expect(error).toBeInstanceOf(NativeCrashError);
    expect(error.details.rawLines).toEqual(['MyApp[123] fatal error: boom']);
  });

  it('asks the app session to extract native crash details for the current test', async () => {
    const occurredAt = Date.now();
    const getCrashDetails = vi.fn(async () => ({
      artifactType: 'logcat' as const,
      artifactPath: '/tmp/.harness/crash-reports/crash-logcat.txt',
      processName: 'com.harnessplayground',
      pid: 7777,
    }));
    const { session, setState } = createAppSessionMock(
      { status: 'running' },
      [],
      getCrashDetails
    );
    const cm = createCrashMonitor({ appSession: session });
    const watch = cm.watch('/test/example.ts', 'execution');
    watch.promise.catch(noop);

    cm.handleBridgeDisconnect();
    setState({
      status: 'exited',
      occurredAt,
      pid: 7777,
      reason: 'process-gone',
    });

    const error = await watch.promise.catch((err: NativeCrashError) => err);

    expect(getCrashDetails).toHaveBeenCalledWith({
      occurredAt: expect.any(Number),
      pid: 7777,
      processName: undefined,
      testFilePath: '/test/example.ts',
    });
    expect(error.details.artifactPath).toBe(
      '/tmp/.harness/crash-reports/crash-logcat.txt'
    );
    expect(error.message).toContain(
      `Harness extracted the crash log: ${path.relative(
        process.cwd(),
        '/tmp/.harness/crash-reports/crash-logcat.txt'
      )}`
    );
  });

  it('falls back to log details when native crash extraction fails', async () => {
    const occurredAt = Date.now();
    const getCrashDetails = vi.fn(async () => {
      throw new Error('copy failed');
    });
    const { session, setState } = createAppSessionMock(
      { status: 'running' },
      [{ line: 'MyApp[123] fatal error: boom', occurredAt }],
      getCrashDetails
    );
    const cm = createCrashMonitor({ appSession: session });
    const watch = cm.watch('/test/example.ts', 'execution');
    watch.promise.catch(noop);

    cm.handleBridgeDisconnect();
    setState({ status: 'exited', occurredAt, reason: 'process-gone' });

    const error = await watch.promise.catch((err: NativeCrashError) => err);

    expect(error.details.rawLines).toEqual(['MyApp[123] fatal error: boom']);
    expect(error.message).toContain("Harness couldn't extract the crash log.");
  });

  it('settles the promise with CrashWatchCancelledError on cancel()', async () => {
    const cm = createCrashMonitor();
    const watch = cm.watch('test.ts', 'execution');

    watch.cancel();

    await expect(watch.promise).rejects.toBeInstanceOf(
      CrashWatchCancelledError
    );
  });

  it('ignores session events while stopped', async () => {
    const { session, emit } = createAppSessionMock({
      status: 'exited',
      occurredAt: Date.now(),
    });
    const cm = createCrashMonitor({ appSession: session });
    await cm.stop();

    const watch = cm.watch('test.ts', 'execution');
    const settled = vi.fn();
    watch.promise.then(settled, settled);

    emit({ type: 'app_exited' });
    await waitForClassification();

    expect(settled).not.toHaveBeenCalled();
    watch.cancel();
  });

  it('removes the app session listener on dispose', async () => {
    const { session } = createAppSessionMock();
    const cm = createCrashMonitor({ appSession: session });

    await cm.dispose();

    expect(session.removeListener).toHaveBeenCalledOnce();
    expect(cm.isAlive()).toBe(false);
  });
});
