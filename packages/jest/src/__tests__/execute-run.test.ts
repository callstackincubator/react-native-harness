import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Config, Test, TestWatcher } from 'jest-runner';
import type { TestResult as JestTestResult } from '@jest/test-result';
import type {
  TestRunnerTestFinishedEvent,
  TestRunnerTestStartedEvent,
  TestSuiteResult,
} from '@react-native-harness/bridge';
import { NativeCrashError, StartupStallError } from '../errors.js';
import {
  AppBridgeDisconnectedError,
  DeviceNotRespondingError,
} from '@react-native-harness/bridge/server';
import type { HarnessSession } from '../harness-session.js';
import { executeRun } from '../execute-run.js';

type EmitEvent = Parameters<typeof executeRun>[3];
type RecordedEmitEvent = {
  emitEvent: EmitEvent;
  calls: Array<unknown[]>;
};

const resolveUndefined = async () => undefined;

// Mock the file-runner so we control what jestResult/harnessResult each test returns
// without needing a real Jest config or Metro bundler.
const mockRunHarnessTestFile = vi.hoisted(() => vi.fn());
vi.mock('../run.js', () => ({
  runHarnessTestFile: mockRunHarnessTestFile,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeJestResult = (
  overrides: Partial<JestTestResult> = {},
): JestTestResult =>
  ({
    testFilePath: '/test/example.ts',
    testResults: [],
    failureMessage: null,
    numFailingTests: 0,
    numPassingTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
    leaks: false,
    openHandles: [],
    skipped: false,
    snapshot: {
      added: 0, fileDeleted: false, matched: 0, unchecked: 0,
      uncheckedKeys: [], unmatched: 0, updated: 0,
    },
    perfStats: { start: 0, end: 1, runtime: 1, slow: false,
      loadTestEnvironmentStart: 0, loadTestEnvironmentEnd: 0,
      setupAfterEnvStart: 0, setupAfterEnvEnd: 0,
      setupFilesStart: 0, setupFilesEnd: 0 },
    coverage: undefined,
    ...overrides,
  } as JestTestResult);

const makeHarnessResult = (status: 'passed' | 'failed' = 'passed'): TestSuiteResult => ({
  name: 'suite',
  tests: [],
  suites: [],
  status,
  duration: 50,
});

const makeFileRunResult = (overrides: Partial<ReturnType<typeof mockRunHarnessTestFile>> = {}) => ({
  jestResult: makeJestResult(),
  harnessResult: makeHarnessResult(),
  relativeTestPath: 'example.ts',
  duration: 50,
  ...overrides,
});

const makeTest = (filePath = '/test/example.ts'): Test => ({
  path: filePath,
  context: { config: {} as Config.ProjectConfig },
} as Test);

const makeWatcher = (interrupted = false): TestWatcher =>
  ({ isInterrupted: () => interrupted }) as TestWatcher;

const makeGlobalConfig = (overrides: Partial<Config.GlobalConfig> = {}): Config.GlobalConfig =>
  ({
    rootDir: '/project',
    watch: false,
    watchAll: false,
    collectCoverage: false,
    ...overrides,
  } as Config.GlobalConfig);

const makeSession = (overrides: Partial<HarnessSession> = {}): HarnessSession => ({
  config: {
    metroPort: 8081,
    host: undefined,
    resetEnvironmentBetweenTestFiles: false,
    detectNativeCrashes: true,
    runners: [
      { platformId: 'android', name: 'android' },
      { platformId: 'ios', name: 'ios' },
    ],
  } as HarnessSession['config'],
  context: {
    platform: {
      platformId: 'android',
      name: 'android',
      runner: '/virtual/android-runner.js',
      cli: '/virtual/android-cli.js',
      config: {},
    },
  } as HarnessSession['context'],
  ensureAppReady: vi.fn(resolveUndefined),
  runTestFile: vi.fn(async () => makeHarnessResult()),
  restartApp: vi.fn(resolveUndefined),
  resetCrashState: vi.fn(),
  flushClientLogs: vi.fn(() => []),
  callHook: vi.fn(resolveUndefined),
  onTestRunnerEvent: vi.fn(() => () => undefined),
  setRunState: vi.fn(),
  dispose: vi.fn(resolveUndefined),
  ...overrides,
});

const makeEmitEvent = (): RecordedEmitEvent => {
  const calls: Array<unknown[]> = [];
  const emitEvent: EmitEvent = (async (...eventData) => {
    calls.push(eventData);
  }) as EmitEvent;

  return { emitEvent, calls };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockRunHarnessTestFile.mockResolvedValue(makeFileRunResult());
});

describe('executeRun', () => {
  describe('lifecycle hooks', () => {
    it('emits run:started then run:finished in order', async () => {
      const hookNames: string[] = [];
      const session = makeSession({
        callHook: vi.fn(async (name) => { hookNames.push(name as string); }),
      });

      await executeRun(session, [makeTest()], makeWatcher(), makeEmitEvent().emitEvent, makeGlobalConfig());

      expect(hookNames[0]).toBe('run:started');
      expect(hookNames[hookNames.length - 1]).toBe('run:finished');
    });

    it('emits test-file:started and test-file:finished around each test', async () => {
      const hookNames: string[] = [];
      const session = makeSession({
        callHook: vi.fn(async (name) => { hookNames.push(name as string); }),
      });

      await executeRun(session, [makeTest('/a.ts'), makeTest('/b.ts')], makeWatcher(), makeEmitEvent().emitEvent, makeGlobalConfig());

      const fileHooks = hookNames.filter((n) =>
        n === 'test-file:started' || n === 'test-file:finished',
      );
      expect(fileHooks).toEqual([
        'test-file:started', 'test-file:finished',
        'test-file:started', 'test-file:finished',
      ]);
    });

    it('always emits run:finished even when a test throws', async () => {
      const hookNames: string[] = [];
      const session = makeSession({
        callHook: vi.fn(async (name) => { hookNames.push(name as string); }),
        ensureAppReady: vi.fn(async () => { throw new Error('unexpected'); }),
      });

      await executeRun(session, [makeTest()], makeWatcher(), makeEmitEvent().emitEvent, makeGlobalConfig());

      expect(hookNames).toContain('run:finished');
    });
  });

  describe('happy path', () => {
    it('emits file start, ensureAppReady, runTestFile, file success in order', async () => {
      const order: string[] = [];
      const session = makeSession({
        ensureAppReady: vi.fn(async () => { order.push('ensureAppReady'); }),
      });
      const emitEvent: EmitEvent = (async (eventName) => {
        if (eventName === 'test-file-start') {
          order.push('test-file-start');
        }

        if (eventName === 'test-file-success') {
          order.push('test-file-success');
        }
      }) as EmitEvent;

      mockRunHarnessTestFile.mockImplementation(async () => {
        order.push('runTestFile');
        return makeFileRunResult();
      });

      await executeRun(session, [makeTest()], makeWatcher(), emitEvent, makeGlobalConfig());

      expect(order).toEqual([
        'test-file-start',
        'ensureAppReady',
        'runTestFile',
        'test-file-success',
      ]);
    });

    it('accumulates passing test counts in run:finished summary', async () => {
      let finishedPayload: unknown;
      const session = makeSession({
        callHook: vi.fn(async (name, payload) => {
          if (name === 'run:finished') finishedPayload = payload;
        }),
      });

      mockRunHarnessTestFile.mockResolvedValue(
        makeFileRunResult({ jestResult: makeJestResult({ numPassingTests: 3 }) }),
      );

      await executeRun(session, [makeTest(), makeTest('/b.ts')], makeWatcher(), makeEmitEvent().emitEvent, makeGlobalConfig());

      const payload = finishedPayload as { summary: { passed: number }; status: string };
      expect(payload.summary.passed).toBe(6);
      expect(payload.status).toBe('passed');
    });

    it('attaches buffered client logs to the Jest result', async () => {
      const clientLogs = [{ message: 'Loaded screen', origin: '', type: 'warn' }] satisfies NonNullable<JestTestResult['console']>;
      const session = makeSession({
        flushClientLogs: vi.fn()
          .mockReturnValueOnce([])
          .mockReturnValueOnce(clientLogs),
      });
      const { emitEvent, calls } = makeEmitEvent();

      await executeRun(
        session,
        [makeTest()],
        makeWatcher(),
        emitEvent,
        makeGlobalConfig(),
      );

      expect(session.flushClientLogs).toHaveBeenCalledTimes(2);
      expect(calls).toContainEqual([
        'test-file-success',
        expect.anything(),
        expect.objectContaining({ console: clientLogs }),
      ]);
    });

    it('emits test-case events before file success', async () => {
      let testRunnerListener:
        | ((event: TestRunnerTestStartedEvent | TestRunnerTestFinishedEvent) => void)
        | undefined;
      const { emitEvent, calls: emittedEvents } = makeEmitEvent();
      const session = makeSession({
        onTestRunnerEvent: vi.fn((listener) => {
          testRunnerListener = listener as typeof testRunnerListener;
          return () => undefined;
        }),
      });

      mockRunHarnessTestFile.mockImplementation(async () => {
        testRunnerListener?.({
          type: 'test-started',
          file: 'example.ts',
          suite: 'suite',
          name: 'works',
          ancestorTitles: ['suite'],
          fullName: 'suite works',
          startedAt: 10,
          declarationMode: 'only',
        });
        testRunnerListener?.({
          type: 'test-finished',
          file: 'example.ts',
          suite: 'suite',
          name: 'works',
          ancestorTitles: ['suite'],
          fullName: 'suite works',
          startedAt: 10,
          declarationMode: 'only',
          duration: 5,
          status: 'passed',
        });

        return makeFileRunResult();
      });

      await executeRun(session, [makeTest()], makeWatcher(), emitEvent, makeGlobalConfig());

      expect(emittedEvents).toEqual([
        ['test-file-start', expect.anything()],
        [
          'test-case-start',
          'example.ts',
          expect.objectContaining({
            ancestorTitles: ['suite'],
            fullName: 'suite works',
            mode: 'only',
            title: 'works',
            startedAt: 10,
          }),
        ],
        [
          'test-case-result',
          'example.ts',
          expect.objectContaining({
            ancestorTitles: ['suite'],
            fullName: 'suite works',
            numPassingAsserts: 1,
            startedAt: 10,
            status: 'passed',
            title: 'works',
          }),
        ],
        ['test-file-success', expect.anything(), expect.anything()],
      ]);
    });

    it('includes pending promise diagnostics in live test-case failures', async () => {
      let testRunnerListener:
        | ((event: TestRunnerTestStartedEvent | TestRunnerTestFinishedEvent) => void)
        | undefined;
      const { emitEvent, calls: emittedEvents } = makeEmitEvent();
      const session = makeSession({
        onTestRunnerEvent: vi.fn((listener) => {
          testRunnerListener = listener as typeof testRunnerListener;
          return () => undefined;
        }),
      });

      mockRunHarnessTestFile.mockImplementation(async () => {
        testRunnerListener?.({
          type: 'test-finished',
          file: 'example.ts',
          suite: 'suite',
          name: 'hangs',
          ancestorTitles: ['suite'],
          fullName: 'suite hangs',
          startedAt: 100,
          duration: 50,
          status: 'failed',
          error: {
            name: 'TestCaseTimeoutError',
            message: 'Test timed out after 50ms: suite hangs',
            diagnostics: {
              pendingPromises: {
                total: 1,
                items: [
                  {
                    id: 7,
                    createdAt: 110,
                    stack: 'Error: Promise created\n    at hangs (example.ts:10:5)',
                  },
                ],
              },
            },
          },
        });

        return makeFileRunResult();
      });

      await executeRun(session, [makeTest()], makeWatcher(), emitEvent, makeGlobalConfig());

      expect(emittedEvents).toContainEqual([
        'test-case-result',
        'example.ts',
        expect.objectContaining({
          failureMessages: [
            expect.stringContaining(
              'Pending promises at timeout: 1\n\nPromise #7, created 10ms after test start:',
            ),
          ],
        }),
      ]);
    });
  });

  describe('runtime failures', () => {
    it('passes StartupStallError to onFailure with an empty stack', async () => {
      const { emitEvent, calls } = makeEmitEvent();
      const session = makeSession({
        ensureAppReady: vi.fn().mockRejectedValue(new StartupStallError(1500, 3)),
      });

      await executeRun(session, [makeTest()], makeWatcher(), emitEvent, makeGlobalConfig());

      expect(calls).toContainEqual([
        'test-file-failure',
        expect.objectContaining({ path: '/test/example.ts' }),
        expect.objectContaining({ message: expect.stringContaining('1500'), stack: '' }),
      ]);
    });

    it('passes DeviceNotRespondingError to onFailure with an empty stack', async () => {
      const { emitEvent, calls } = makeEmitEvent();
      const session = makeSession({
        ensureAppReady: vi.fn().mockRejectedValue(
          new DeviceNotRespondingError('runTests', []),
        ),
      });

      await executeRun(session, [makeTest()], makeWatcher(), emitEvent, makeGlobalConfig());

      expect(calls).toContainEqual([
        'test-file-failure',
        expect.anything(),
        expect.objectContaining({ stack: '' }),
      ]);
    });

    it('passes AppBridgeDisconnectedError to onFailure with an empty stack', async () => {
      const { emitEvent, calls } = makeEmitEvent();
      const session = makeSession({
        ensureAppReady: vi.fn().mockRejectedValue(
          new AppBridgeDisconnectedError('app-disconnected'),
        ),
      });

      await executeRun(session, [makeTest()], makeWatcher(), emitEvent, makeGlobalConfig());

      expect(calls).toContainEqual([
        'test-file-failure',
        expect.anything(),
        expect.objectContaining({
          message: expect.stringContaining('The app bridge disconnected during test execution.'),
          stack: '',
        }),
      ]);
    });

    it('calls resetCrashState after a NativeCrashError', async () => {
      const session = makeSession({
        ensureAppReady: vi.fn().mockRejectedValue(
          new NativeCrashError('example.ts', { phase: 'execution', source: 'polling' }),
        ),
      });

      await executeRun(session, [makeTest()], makeWatcher(), makeEmitEvent().emitEvent, makeGlobalConfig());

      expect(session.resetCrashState).toHaveBeenCalled();
    });

    it('counts runtime failures in the summary', async () => {
      let finishedPayload: unknown;
      const session = makeSession({
        callHook: vi.fn(async (name, payload) => {
          if (name === 'run:finished') finishedPayload = payload;
        }),
        ensureAppReady: vi.fn().mockRejectedValue(new StartupStallError(1000, 2)),
      });

      await executeRun(session, [makeTest()], makeWatcher(), makeEmitEvent().emitEvent, makeGlobalConfig());

      const payload = finishedPayload as { summary: { failed: number }; status: string };
      expect(payload.summary.failed).toBe(1);
      expect(payload.status).toBe('failed');
    });
  });

  describe('watcher interrupt', () => {
    it('stops processing tests and still emits run:finished', async () => {
      const hookNames: string[] = [];
      const session = makeSession({
        callHook: vi.fn(async (name) => { hookNames.push(name as string); }),
      });
      const { emitEvent, calls } = makeEmitEvent();

      await executeRun(
        session,
        [makeTest('/a.ts'), makeTest('/b.ts')],
        makeWatcher(true /* interrupted */),
        emitEvent,
        makeGlobalConfig(),
      );

      // No test was started; watcher was already interrupted.
      expect(calls).not.toContainEqual(['test-file-start', expect.anything()]);
      expect(hookNames).toContain('run:finished');
    });
  });

  describe('resetEnvironmentBetweenTestFiles', () => {
    it('calls restartApp before the second test but not the first', async () => {
      const session = makeSession({
        config: {
          metroPort: 8081,
          resetEnvironmentBetweenTestFiles: true,
          detectNativeCrashes: false,
          runners: [
            { platformId: 'android', name: 'android' },
            { platformId: 'ios', name: 'ios' },
          ],
        } as HarnessSession['config'],
      });

      await executeRun(
        session,
        [makeTest('/a.ts'), makeTest('/b.ts'), makeTest('/c.ts')],
        makeWatcher(),
        makeEmitEvent().emitEvent,
        makeGlobalConfig(),
      );

      // restartApp should be called for tests 2 and 3, not test 1.
      expect(session.restartApp).toHaveBeenCalledTimes(2);
    });

    it('restarts after a test case timeout before the next runnable file', async () => {
      const timedOutResult = makeHarnessResult('failed');
      timedOutResult.tests = [
        {
          name: 'hangs',
          status: 'failed',
          duration: 10,
          error: {
            name: 'TestCaseTimeoutError',
            message: 'Test timed out after 10ms: hangs',
          },
        },
      ];
      mockRunHarnessTestFile
        .mockResolvedValueOnce(makeFileRunResult({
          harnessResult: timedOutResult,
          jestResult: makeJestResult({
            numFailingTests: 1,
            numPassingTests: 0,
          }),
        }))
        .mockResolvedValueOnce(makeFileRunResult());
      const session = makeSession({
        config: {
          metroPort: 8081,
          resetEnvironmentBetweenTestFiles: false,
          detectNativeCrashes: false,
          runners: [
            { platformId: 'android', name: 'android' },
            { platformId: 'ios', name: 'ios' },
          ],
        } as HarnessSession['config'],
      });

      await executeRun(
        session,
        [makeTest('/a.ts'), makeTest('/b.ts')],
        makeWatcher(),
        makeEmitEvent().emitEvent,
        makeGlobalConfig(),
      );

      expect(session.restartApp).toHaveBeenCalledTimes(1);
      expect(session.restartApp).toHaveBeenCalledWith('/a.ts');
    });

    it('restarts after a timeout in the last runnable file', async () => {
      const timedOutResult = makeHarnessResult('failed');
      timedOutResult.tests = [
        {
          name: 'hangs',
          status: 'failed',
          duration: 10,
          error: {
            name: 'TestCaseTimeoutError',
            message: 'Test timed out after 10ms: hangs',
          },
        },
      ];
      mockRunHarnessTestFile.mockResolvedValueOnce(makeFileRunResult({
        harnessResult: timedOutResult,
        jestResult: makeJestResult({
          numFailingTests: 1,
          numPassingTests: 0,
        }),
      }));
      const session = makeSession({
        config: {
          metroPort: 8081,
          resetEnvironmentBetweenTestFiles: false,
          detectNativeCrashes: false,
          runners: [
            { platformId: 'android', name: 'android' },
            { platformId: 'ios', name: 'ios' },
          ],
        } as HarnessSession['config'],
      });

      await executeRun(
        session,
        [makeTest('/a.ts')],
        makeWatcher(),
        makeEmitEvent().emitEvent,
        makeGlobalConfig({ watch: true }),
      );

      expect(session.restartApp).toHaveBeenCalledTimes(1);
      expect(session.restartApp).toHaveBeenCalledWith('/a.ts');
    });

    it('restarts after a suite hook timeout', async () => {
      const timedOutResult = makeHarnessResult('failed');
      timedOutResult.suites = [
        {
          name: 'suite',
          tests: [],
          suites: [],
          status: 'failed',
          duration: 10,
          error: {
            name: 'SuiteHookTimeoutError',
            message: 'beforeAll hook timed out after 10ms in suite: suite',
          },
        },
      ];
      mockRunHarnessTestFile.mockResolvedValueOnce(makeFileRunResult({
        harnessResult: timedOutResult,
        jestResult: makeJestResult({
          numFailingTests: 1,
          numPassingTests: 0,
        }),
      }));
      const session = makeSession();

      await executeRun(
        session,
        [makeTest('/a.ts')],
        makeWatcher(),
        makeEmitEvent().emitEvent,
        makeGlobalConfig(),
      );

      expect(session.restartApp).toHaveBeenCalledTimes(1);
      expect(session.restartApp).toHaveBeenCalledWith('/a.ts');
    });
  });

  describe('platform-specific test files', () => {
    it('skips files for other platforms without running them on the device', async () => {
      const session = makeSession();
      const { emitEvent, calls } = makeEmitEvent();

      await executeRun(
        session,
        [
          makeTest('/project/smoke.harness.ts'),
          makeTest('/project/kotlin.android.harness.ts'),
          makeTest('/project/swift.ios.harness.ts'),
        ],
        makeWatcher(),
        emitEvent,
        makeGlobalConfig(),
      );

      expect(mockRunHarnessTestFile).toHaveBeenCalledTimes(2);
      expect(mockRunHarnessTestFile).toHaveBeenCalledWith(
        expect.objectContaining({ testPath: '/project/smoke.harness.ts' }),
      );
      expect(mockRunHarnessTestFile).toHaveBeenCalledWith(
        expect.objectContaining({ testPath: '/project/kotlin.android.harness.ts' }),
      );
      expect(session.ensureAppReady).toHaveBeenCalledTimes(2);
      expect(calls).toContainEqual([
        'test-file-success',
        expect.objectContaining({ path: '/project/swift.ios.harness.ts' }),
        expect.objectContaining({ skipped: true }),
      ]);
    });

    it('does not restart the app for skipped platform-specific files', async () => {
      const session = makeSession({
        config: {
          metroPort: 8081,
          resetEnvironmentBetweenTestFiles: true,
          detectNativeCrashes: false,
          runners: [
            { platformId: 'android', name: 'android' },
            { platformId: 'ios', name: 'ios' },
          ],
        } as HarnessSession['config'],
      });

      await executeRun(
        session,
        [
          makeTest('/project/swift.ios.harness.ts'),
          makeTest('/project/kotlin.android.harness.ts'),
        ],
        makeWatcher(),
        vi.fn(),
        makeGlobalConfig(),
      );

      expect(session.restartApp).not.toHaveBeenCalled();
      expect(mockRunHarnessTestFile).toHaveBeenCalledTimes(1);
    });
  });
});
