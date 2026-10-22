import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Config, Test, TestEvents, TestRunnerOptions, TestWatcher } from 'jest-runner';
import type { TestSuiteResult } from '@react-native-harness/bridge';
import type { HarnessSession } from '../harness-session.js';
import type { executeRun as ExecuteRun } from '../execute-run.js';
import {
  createDiagnostics,
  getEmitter,
  HarnessError,
  type LifecycleEvent,
} from '@react-native-harness/tools';
import JestHarness from '../index.js';
import { resetWatchSessionForTests } from '../watch-session.js';

const resolveUndefined = async () => undefined;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockSession: HarnessSession = {
  config: { metroPort: 8081 } as HarnessSession['config'],
  context: {} as HarnessSession['context'],
  diagnostics: createDiagnostics({ enabled: false }),
  sessionId: 'session-1',
  lifecycle: getEmitter<LifecycleEvent>(),
  onTestRunnerEvent: vi.fn(() => () => undefined),
  ensureAppReady: vi.fn(resolveUndefined),
  runTestFile: vi.fn(async (): Promise<TestSuiteResult> => ({
    name: '',
    tests: [],
    suites: [],
    status: 'passed',
    duration: 0,
  })),
  restartApp: vi.fn(resolveUndefined),
  resetEnvironment: vi.fn(resolveUndefined),
  resetCrashState: vi.fn(),
  flushClientLogs: vi.fn(() => []),
  callHook: vi.fn(resolveUndefined),
  setRunState: vi.fn(),
  dispose: vi.fn(resolveUndefined),
};

const mockCreateHarnessSession = vi.hoisted(() => vi.fn(async () => mockSession));
const mockExecuteRun = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../harness-session.js', () => ({
  createHarnessSession: mockCreateHarnessSession,
}));

vi.mock('../execute-run.js', () => ({
  executeRun: mockExecuteRun,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeOptions = (): TestRunnerOptions => ({ serial: true });
const makeWatcher = (): TestWatcher => ({ isInterrupted: () => false } as TestWatcher);
const makeTest = (): Test => ({
  path: '/test/example.ts',
  context: { config: {} as Config.ProjectConfig },
} as Test);

const makeGlobalConfig = (overrides: Partial<Config.GlobalConfig> = {}): Config.GlobalConfig =>
  ({ rootDir: '/project', watch: false, watchAll: false, collectCoverage: false, ...overrides } as Config.GlobalConfig);

const watchConfig = (overrides: Partial<Config.GlobalConfig> = {}) =>
  makeGlobalConfig({ watch: true, ...overrides });

type ExecuteRunMock = typeof ExecuteRun;
type TypedExecuteRunMock = typeof mockExecuteRun & {
  mockImplementationOnce: (implementation: ExecuteRunMock) => typeof mockExecuteRun;
  mockResolvedValue: (value: Awaited<ReturnType<ExecuteRunMock>>) => typeof mockExecuteRun;
};
type ExecuteRunParams = Parameters<ExecuteRunMock>;

const typedMockExecuteRun = mockExecuteRun as TypedExecuteRunMock;

const makeTestCaseStartPayload = (): TestEvents['test-case-start'] => [
  '/test/example.ts',
  {
    ancestorTitles: [],
    fullName: 'suite case',
    mode: undefined,
    title: 'case',
    startedAt: 1,
  },
];

const makeTestCaseResultPayload = (): TestEvents['test-case-result'] => [
  '/test/example.ts',
  {
    ancestorTitles: [],
    duration: 1,
    failureDetails: [],
    failureMessages: [],
    fullName: 'suite case',
    numPassingAsserts: 1,
    startedAt: 1,
    status: 'passed',
    title: 'case',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetWatchSessionForTests();
  vi.clearAllMocks();
  (mockSession.dispose as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  typedMockExecuteRun.mockResolvedValue(undefined);
  mockCreateHarnessSession.mockResolvedValue(mockSession);
});

describe('JestHarness', () => {
  describe('session lifecycle', () => {
    it('creates a session on the first run', async () => {
      const runner = new JestHarness(makeGlobalConfig());

      await runner.runTests([makeTest()], makeWatcher(), makeOptions());

      expect(mockCreateHarnessSession).toHaveBeenCalledOnce();
    });

    it('reuses the session across runs in watch mode', async () => {
      const runner = new JestHarness(makeGlobalConfig({ watch: true }));

      await runner.runTests([makeTest()], makeWatcher(), makeOptions());
      await runner.runTests([makeTest()], makeWatcher(), makeOptions());

      expect(mockCreateHarnessSession).toHaveBeenCalledOnce();
      expect(mockSession.dispose).not.toHaveBeenCalled();
    });

    it('reuses the session across runner instances in watch mode', async () => {
      const first = new JestHarness(watchConfig());
      const second = new JestHarness(watchConfig());

      await first.runTests([makeTest()], makeWatcher(), makeOptions());
      await second.runTests([makeTest()], makeWatcher(), makeOptions());

      expect(mockCreateHarnessSession).toHaveBeenCalledOnce();
      expect(mockSession.dispose).not.toHaveBeenCalled();
      expect(mockExecuteRun).toHaveBeenCalledTimes(2);
    });

    it('creates one session for overlapping watch runs', async () => {
      await Promise.all([
        new JestHarness(watchConfig()).runTests([makeTest()], makeWatcher(), makeOptions()),
        new JestHarness(watchConfig()).runTests([makeTest()], makeWatcher(), makeOptions()),
      ]);

      expect(mockCreateHarnessSession).toHaveBeenCalledOnce();
    });

    it('does not cache a failed watch session creation', async () => {
      mockCreateHarnessSession.mockRejectedValueOnce(new Error('boom'));

      await expect(
        new JestHarness(watchConfig()).runTests([makeTest()], makeWatcher(), makeOptions()),
      ).rejects.toThrow('boom');
      await new JestHarness(watchConfig()).runTests([makeTest()], makeWatcher(), makeOptions());

      expect(mockCreateHarnessSession).toHaveBeenCalledTimes(2);
    });

    it('replaces the watch session when the config changes', async () => {
      await new JestHarness(watchConfig({ rootDir: '/a' })).runTests(
        [makeTest()], makeWatcher(), makeOptions(),
      );
      await new JestHarness(watchConfig({ rootDir: '/b' })).runTests(
        [makeTest()], makeWatcher(), makeOptions(),
      );

      expect(mockSession.dispose).toHaveBeenCalledOnce();
      expect(mockCreateHarnessSession).toHaveBeenCalledTimes(2);
    });

    it('creates one new session for overlapping runs after a config change', async () => {
      await new JestHarness(watchConfig({ rootDir: '/a' })).runTests(
        [makeTest()], makeWatcher(), makeOptions(),
      );

      await Promise.all([
        new JestHarness(watchConfig({ rootDir: '/b' })).runTests([makeTest()], makeWatcher(), makeOptions()),
        new JestHarness(watchConfig({ rootDir: '/b' })).runTests([makeTest()], makeWatcher(), makeOptions()),
      ]);

      expect(mockSession.dispose).toHaveBeenCalledOnce();
      expect(mockCreateHarnessSession).toHaveBeenCalledTimes(2);
    });

    it('continues when disposing the stale watch session fails', async () => {
      await new JestHarness(watchConfig({ rootDir: '/a' })).runTests(
        [makeTest()], makeWatcher(), makeOptions(),
      );
      vi.mocked(mockSession.dispose).mockRejectedValueOnce(new Error('dispose failed'));

      await expect(
        new JestHarness(watchConfig({ rootDir: '/b' })).runTests(
          [makeTest()], makeWatcher(), makeOptions(),
        ),
      ).resolves.toBeUndefined();

      expect(mockCreateHarnessSession).toHaveBeenCalledTimes(2);
    });

    it('disposes the session after each run in normal mode', async () => {
      const runner = new JestHarness(makeGlobalConfig());

      await runner.runTests([makeTest()], makeWatcher(), makeOptions());

      expect(mockSession.dispose).toHaveBeenCalledOnce();
    });

    it('creates a fresh session for each run in normal mode', async () => {
      const runner = new JestHarness(makeGlobalConfig());

      await runner.runTests([makeTest()], makeWatcher(), makeOptions());
      await runner.runTests([makeTest()], makeWatcher(), makeOptions());

      expect(mockCreateHarnessSession).toHaveBeenCalledTimes(2);
    });

    it('emits registered Jest events', async () => {
      const runner = new JestHarness(makeGlobalConfig());
      const listener = vi.fn();
      const eventPayload = makeTestCaseStartPayload();

      runner.on('test-case-start', listener);
      typedMockExecuteRun.mockImplementationOnce(async (
        _session: ExecuteRunParams[0],
        _tests: ExecuteRunParams[1],
        _watcher: ExecuteRunParams[2],
        emitEvent: ExecuteRunParams[3],
      ) => {
        await emitEvent('test-case-start', ...eventPayload);
      });

      await runner.runTests([makeTest()], makeWatcher(), makeOptions());

      expect(listener).toHaveBeenCalledWith(eventPayload);
    });

    it('stops emitting after listener unsubscribe', async () => {
      const runner = new JestHarness(makeGlobalConfig());
      const listener = vi.fn();
      const unsubscribe = runner.on('test-case-result', listener);
      const eventPayload = makeTestCaseResultPayload();

      unsubscribe();
      typedMockExecuteRun.mockImplementationOnce(async (
        _session: ExecuteRunParams[0],
        _tests: ExecuteRunParams[1],
        _watcher: ExecuteRunParams[2],
        emitEvent: ExecuteRunParams[3],
      ) => {
        await emitEvent('test-case-result', ...eventPayload);
      });

      await runner.runTests([makeTest()], makeWatcher(), makeOptions());

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('converts HarnessError into a formatted string before throwing', async () => {
      class TestHarnessError extends HarnessError {
        constructor() { super('something went wrong'); this.name = 'TestHarnessError'; }
      }

      mockCreateHarnessSession.mockRejectedValue(new TestHarnessError());

      const runner = new JestHarness(makeGlobalConfig());

      await expect(
        runner.runTests([makeTest()], makeWatcher(), makeOptions()),
      ).rejects.toBeTypeOf('string');
    });

    it('propagates non-HarnessError exceptions as-is', async () => {
      const cause = new TypeError('unexpected');
      mockCreateHarnessSession.mockRejectedValue(cause);

      const runner = new JestHarness(makeGlobalConfig());

      await expect(
        runner.runTests([makeTest()], makeWatcher(), makeOptions()),
      ).rejects.toBe(cause);
    });

    it('throws when called without serial flag', async () => {
      const runner = new JestHarness(makeGlobalConfig());

      await expect(
        runner.runTests([makeTest()], makeWatcher(), { serial: false }),
      ).rejects.toThrow('Parallel test running is not supported');
    });
  });
});
