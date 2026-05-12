import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Config, Test, TestWatcher } from 'jest-runner';
import type { TestResult as JestTestResult } from '@jest/test-result';
import type { TestSuiteResult } from '@react-native-harness/bridge';
import { NativeCrashError, StartupStallError } from '../errors.js';
import { DeviceNotRespondingError } from '@react-native-harness/bridge/server';
import type { HarnessSession } from '../harness-session.js';
import { executeRun } from '../execute-run.js';

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
  } as HarnessSession['config'],
  context: {} as HarnessSession['context'],
  ensureAppReady: vi.fn(resolveUndefined),
  runTestFile: vi.fn(async () => makeHarnessResult()),
  restartApp: vi.fn(resolveUndefined),
  resetCrashState: vi.fn(),
  flushClientLogs: vi.fn(() => []),
  callHook: vi.fn(resolveUndefined),
  setRunState: vi.fn(),
  dispose: vi.fn(resolveUndefined),
  ...overrides,
});

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

      await executeRun(session, [makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeGlobalConfig());

      expect(hookNames[0]).toBe('run:started');
      expect(hookNames[hookNames.length - 1]).toBe('run:finished');
    });

    it('emits test-file:started and test-file:finished around each test', async () => {
      const hookNames: string[] = [];
      const session = makeSession({
        callHook: vi.fn(async (name) => { hookNames.push(name as string); }),
      });

      await executeRun(session, [makeTest('/a.ts'), makeTest('/b.ts')], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeGlobalConfig());

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

      await executeRun(session, [makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeGlobalConfig());

      expect(hookNames).toContain('run:finished');
    });
  });

  describe('happy path', () => {
    it('calls onStart, ensureAppReady, runTestFile, onResult in order', async () => {
      const order: string[] = [];
      const session = makeSession({
        ensureAppReady: vi.fn(async () => { order.push('ensureAppReady'); }),
      });
      const onStart = vi.fn(async () => { order.push('onStart'); });
      const onResult = vi.fn(async () => { order.push('onResult'); });

      mockRunHarnessTestFile.mockImplementation(async () => {
        order.push('runTestFile');
        return makeFileRunResult();
      });

      await executeRun(session, [makeTest()], makeWatcher(), onStart, onResult, vi.fn(), makeGlobalConfig());

      expect(order).toEqual(['onStart', 'ensureAppReady', 'runTestFile', 'onResult']);
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

      await executeRun(session, [makeTest(), makeTest('/b.ts')], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeGlobalConfig());

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
      const onResult = vi.fn();

      await executeRun(
        session,
        [makeTest()],
        makeWatcher(),
        vi.fn(),
        onResult,
        vi.fn(),
        makeGlobalConfig(),
      );

      expect(session.flushClientLogs).toHaveBeenCalledTimes(2);
      expect(onResult).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ console: clientLogs }),
      );
    });
  });

  describe('runtime failures', () => {
    it('passes StartupStallError to onFailure with an empty stack', async () => {
      const onFailure = vi.fn();
      const session = makeSession({
        ensureAppReady: vi.fn().mockRejectedValue(new StartupStallError(1500, 3)),
      });

      await executeRun(session, [makeTest()], makeWatcher(), vi.fn(), vi.fn(), onFailure, makeGlobalConfig());

      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/test/example.ts' }),
        expect.objectContaining({ message: expect.stringContaining('1500'), stack: '' }),
      );
    });

    it('passes DeviceNotRespondingError to onFailure with an empty stack', async () => {
      const onFailure = vi.fn();
      const session = makeSession({
        ensureAppReady: vi.fn().mockRejectedValue(
          new DeviceNotRespondingError('runTests', []),
        ),
      });

      await executeRun(session, [makeTest()], makeWatcher(), vi.fn(), vi.fn(), onFailure, makeGlobalConfig());

      expect(onFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ stack: '' }),
      );
    });

    it('calls resetCrashState after a NativeCrashError', async () => {
      const session = makeSession({
        ensureAppReady: vi.fn().mockRejectedValue(
          new NativeCrashError('example.ts', { phase: 'execution', source: 'polling' }),
        ),
      });

      await executeRun(session, [makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeGlobalConfig());

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

      await executeRun(session, [makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeGlobalConfig());

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
      const onStart = vi.fn();

      await executeRun(
        session,
        [makeTest('/a.ts'), makeTest('/b.ts')],
        makeWatcher(true /* interrupted */),
        onStart,
        vi.fn(),
        vi.fn(),
        makeGlobalConfig(),
      );

      // No test was started; watcher was already interrupted.
      expect(onStart).not.toHaveBeenCalled();
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
        } as HarnessSession['config'],
      });

      await executeRun(
        session,
        [makeTest('/a.ts'), makeTest('/b.ts'), makeTest('/c.ts')],
        makeWatcher(),
        vi.fn(), vi.fn(), vi.fn(),
        makeGlobalConfig(),
      );

      // restartApp should be called for tests 2 and 3, not test 1.
      expect(session.restartApp).toHaveBeenCalledTimes(2);
    });
  });
});
