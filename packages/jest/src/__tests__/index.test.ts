import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Config, Test, TestRunnerOptions, TestWatcher } from 'jest-runner';
import type { TestSuiteResult } from '@react-native-harness/bridge';
import type { HarnessSession } from '../harness-session.js';
import { HarnessError } from '@react-native-harness/tools';
import JestHarness from '../index.js';

const resolveUndefined = async () => undefined;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockSession: HarnessSession = {
  config: { metroPort: 8081 } as HarnessSession['config'],
  context: {} as HarnessSession['context'],
  ensureAppReady: vi.fn(resolveUndefined),
  runTestFile: vi.fn(async (): Promise<TestSuiteResult> => ({
    name: '',
    tests: [],
    suites: [],
    status: 'passed',
    duration: 0,
  })),
  restartApp: vi.fn(resolveUndefined),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  (mockSession.dispose as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  mockExecuteRun.mockResolvedValue(undefined);
  mockCreateHarnessSession.mockResolvedValue(mockSession);
});

describe('JestHarness', () => {
  describe('session lifecycle', () => {
    it('creates a session on the first run', async () => {
      const runner = new JestHarness(makeGlobalConfig());

      await runner.runTests([makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeOptions());

      expect(mockCreateHarnessSession).toHaveBeenCalledOnce();
    });

    it('reuses the session across runs in watch mode', async () => {
      const runner = new JestHarness(makeGlobalConfig({ watch: true }));

      await runner.runTests([makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeOptions());
      await runner.runTests([makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeOptions());

      expect(mockCreateHarnessSession).toHaveBeenCalledOnce();
      expect(mockSession.dispose).not.toHaveBeenCalled();
    });

    it('disposes the session after each run in normal mode', async () => {
      const runner = new JestHarness(makeGlobalConfig());

      await runner.runTests([makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeOptions());

      expect(mockSession.dispose).toHaveBeenCalledOnce();
    });

    it('creates a fresh session for each run in normal mode', async () => {
      const runner = new JestHarness(makeGlobalConfig());

      await runner.runTests([makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeOptions());
      await runner.runTests([makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeOptions());

      expect(mockCreateHarnessSession).toHaveBeenCalledTimes(2);
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
        runner.runTests([makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeOptions()),
      ).rejects.toBeTypeOf('string');
    });

    it('propagates non-HarnessError exceptions as-is', async () => {
      const cause = new TypeError('unexpected');
      mockCreateHarnessSession.mockRejectedValue(cause);

      const runner = new JestHarness(makeGlobalConfig());

      await expect(
        runner.runTests([makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), makeOptions()),
      ).rejects.toBe(cause);
    });

    it('throws when called without serial flag', async () => {
      const runner = new JestHarness(makeGlobalConfig());

      await expect(
        runner.runTests([makeTest()], makeWatcher(), vi.fn(), vi.fn(), vi.fn(), { serial: false }),
      ).rejects.toThrow('Parallel test running is not supported');
    });
  });
});
