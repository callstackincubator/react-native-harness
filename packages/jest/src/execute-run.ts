import type {
  Test,
  TestWatcher,
  Config,
  TestEvents,
} from 'jest-runner';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { type HarnessSession, type HarnessRunState } from './harness-session.js';
import { runHarnessTestFile } from './run.js';
import {
  NativeCrashError,
  RuntimeDisconnectError,
  StartupStallError,
} from './errors.js';
import {
  AppBridgeDisconnectedError,
  DeviceNotRespondingError,
} from '@react-native-harness/bridge/server';
import type { TestCaseResult } from '@jest/test-result';
import type {
  TestRunnerEvents,
  TestRunnerTestFinishedEvent,
  TestRunnerTestStartedEvent,
  TestSuiteResult,
} from '@react-native-harness/bridge';
import {
  createPlatformSkippedTestResult,
  shouldRunHarnessTestFile,
} from './test-file-platform-filter.js';
import { formatHarnessErrorMessage } from './format-harness-error.js';

type EmitTestEvent = <Name extends keyof TestEvents>(
  eventName: Name,
  ...eventData: TestEvents[Name]
) => Promise<void>;

const createRunSummary = () => ({ passed: 0, failed: 0, skipped: 0, todo: 0 });

const applyJestResultToSummary = (
  summary: ReturnType<typeof createRunSummary>,
  result: { numPassingTests: number; numFailingTests: number; numPendingTests: number; numTodoTests: number },
) => {
  summary.passed += result.numPassingTests;
  summary.failed += result.numFailingTests;
  summary.skipped += result.numPendingTests;
  summary.todo += result.numTodoTests;
};

class CancelRun extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'CancelRun';
  }
}

const buildTestFailure = (err: unknown): { message: string; stack: string } => {
  if (
    err instanceof NativeCrashError ||
    err instanceof RuntimeDisconnectError ||
    err instanceof StartupStallError ||
    err instanceof AppBridgeDisconnectedError ||
    err instanceof DeviceNotRespondingError
  ) {
    return { message: (err as Error).message, stack: '' };
  }
  return err as { message: string; stack: string };
};

const toJestMode = (
  declarationMode?: 'only' | 'skip' | 'todo',
): 'only' | 'skip' | 'todo' | undefined => declarationMode;

const emitHarnessTestStarted = async (
  emitEvent: EmitTestEvent,
  event: TestRunnerTestStartedEvent,
): Promise<void> => {
  await emitEvent('test-case-start', event.file, {
    ancestorTitles: event.ancestorTitles,
    fullName: event.fullName,
    mode: toJestMode(event.declarationMode),
    title: event.name,
    startedAt: event.startedAt,
  });
};

const emitHarnessTestFinished = async (
  emitEvent: EmitTestEvent,
  event: TestRunnerTestFinishedEvent,
): Promise<void> => {
  const codeFrame = event.error?.codeFrame;
  const failureMessage = formatHarnessErrorMessage(event.error, {
    testStartedAt: event.startedAt,
  });
  const location = codeFrame?.location
    ? { column: codeFrame.location.column, line: codeFrame.location.row }
    : null;
  const testCaseResult: TestCaseResult = {
    ancestorTitles: event.ancestorTitles,
    duration: event.duration,
    failureDetails: [],
    failureMessages: failureMessage ? [failureMessage] : [],
    fullName: event.fullName,
    location,
    numPassingAsserts: event.status === 'passed' ? 1 : 0,
    startedAt: event.startedAt,
    status: event.status,
    title: event.name,
  };

  await emitEvent('test-case-result', event.file, testCaseResult);
};

const isHarnessCaseEvent = (
  event: TestRunnerEvents,
): event is TestRunnerTestStartedEvent | TestRunnerTestFinishedEvent =>
  event.type === 'test-started' || event.type === 'test-finished';

const TIMEOUT_ERROR_NAMES = new Set([
  'SuiteHookTimeoutError',
  'TestCaseTimeoutError',
]);

const hasRuntimeTimeout = (result: TestSuiteResult): boolean =>
  (result.error ? TIMEOUT_ERROR_NAMES.has(result.error.name) : false) ||
  result.tests.some((test) =>
    test.error ? TIMEOUT_ERROR_NAMES.has(test.error.name) : false,
  ) ||
  result.suites.some(hasRuntimeTimeout);

export const executeRun = async (
  session: HarnessSession,
  tests: Array<Test>,
  watcher: TestWatcher,
  emitEvent: EmitTestEvent,
  globalConfig: Config.GlobalConfig,
): Promise<void> => {
  const runId = randomUUID();
  const startTime = Date.now();
  const watchMode = globalConfig.watch || globalConfig.watchAll;
  const rootDir = globalConfig.rootDir ?? process.cwd();
  const testFiles = tests.map((t) => path.relative(rootDir, t.path));
  const summary = createRunSummary();
  let caseEventChain = Promise.resolve();
  const unsubscribe = session.onTestRunnerEvent((event) => {
    if (isHarnessCaseEvent(event)) {
      caseEventChain = caseEventChain.then(() =>
        event.type === 'test-started'
          ? emitHarnessTestStarted(emitEvent, event)
          : emitHarnessTestFinished(emitEvent, event),
      );
    }
  });

  const updateRunState = (overrides: Partial<HarnessRunState> = {}) => {
    const state: HarnessRunState = {
      runId,
      startTime,
      testFiles,
      watchMode,
      coverageEnabled: globalConfig.collectCoverage,
      completed: false,
      summary,
      status: summary.failed > 0 ? 'failed' : 'passed',
      ...overrides,
    };
    session.setRunState(state);
    return state;
  };

  updateRunState();

  await session.callHook('run:started', {
    runId,
    startTime,
    testFiles,
    watchMode,
    coverageEnabled: globalConfig.collectCoverage,
  });
  await session.callHook('metro:initialized', {
    runId,
    port: session.config.metroPort,
    host: session.config.host?.trim() || undefined,
  });

  const shouldResetEnv = session.config.resetEnvironmentBetweenTestFiles;
  const platformId = session.context.platform.platformId;
  const knownPlatformIds = new Set(
    session.config.runners.map((runner) => runner.platformId),
  );
  let isFirstTest = true;
  let shouldRestartAfterTimeout = false;
  let runError: unknown;

  try {
    for (const test of tests) {
      if (watcher.isInterrupted()) throw new CancelRun();

      const relativeTestPath = path.relative(rootDir, test.path);
      const fileStartedAt = Date.now();
      let emittedTestFileFinished = false;

      const emitTestFileFinished = async (options: {
        status: 'passed' | 'failed' | 'skipped' | 'todo';
        duration: number;
        result: Awaited<ReturnType<typeof runHarnessTestFile>>['harnessResult'] | null;
      }) => {
        emittedTestFileFinished = true;
        await session.callHook('test-file:finished', {
          runId,
          file: relativeTestPath,
          duration: options.duration,
          status: options.status,
          result: options.result,
        });
      };

      await session.callHook('test-file:started', { runId, file: relativeTestPath });

      if (
        !shouldRunHarnessTestFile(test.path, platformId, knownPlatformIds)
      ) {
        try {
          await emitEvent('test-file-start', test);
          const skippedResult = createPlatformSkippedTestResult(test.path);
          applyJestResultToSummary(summary, skippedResult);
          updateRunState();
          await emitTestFileFinished({
            status: 'skipped',
            duration: Date.now() - fileStartedAt,
            result: null,
          });
          await emitEvent('test-file-success', test, skippedResult);
        } catch (err) {
          if (!emittedTestFileFinished) {
            await emitTestFileFinished({
              status: 'failed',
              duration: Date.now() - fileStartedAt,
              result: null,
            });
          }
          updateRunState({ error: err });
          await emitEvent('test-file-failure', test, buildTestFailure(err));
        }
        continue;
      }

      try {
        if ((shouldResetEnv && !isFirstTest) || shouldRestartAfterTimeout) {
          await session.restartApp(test.path);
          shouldRestartAfterTimeout = false;
        }
        isFirstTest = false;

        session.flushClientLogs();
        await emitEvent('test-file-start', test);
        await session.ensureAppReady(test.path);

        // Crash detection is handled inside session.runTestFile; NativeCrashError
        // propagates here if a crash wins the race.
        const result = await runHarnessTestFile({
          testPath: test.path,
          session,
          globalConfig,
          projectConfig: test.context.config,
        });

        applyJestResultToSummary(summary, result.jestResult);
        const clientLogs = session.flushClientLogs();
        if (clientLogs.length > 0) {
          result.jestResult.console = clientLogs;
        }
        updateRunState();
        await emitTestFileFinished({
          status: result.harnessResult.status,
          duration: result.duration,
          result: result.harnessResult,
        });
        const didRuntimeTimeout = hasRuntimeTimeout(result.harnessResult);
        shouldRestartAfterTimeout = didRuntimeTimeout;
        await caseEventChain;
        await emitEvent('test-file-success', test, result.jestResult);
        if (didRuntimeTimeout) {
          await session.restartApp(test.path);
          shouldRestartAfterTimeout = false;
        }
      } catch (err) {
        if (!emittedTestFileFinished) {
          await emitTestFileFinished({
            status: 'failed',
            duration: Date.now() - fileStartedAt,
            result: null,
          });
        }

        const isRuntimeFailure =
          err instanceof NativeCrashError ||
          err instanceof RuntimeDisconnectError ||
          err instanceof StartupStallError ||
          err instanceof AppBridgeDisconnectedError ||
          err instanceof DeviceNotRespondingError;

        if (isRuntimeFailure) {
          summary.failed += 1;
          updateRunState();
        }

        if (err instanceof NativeCrashError || err instanceof RuntimeDisconnectError) {
          session.resetCrashState();
        }

        updateRunState({ error: isRuntimeFailure ? undefined : err });
        await caseEventChain;
        await emitEvent('test-file-failure', test, buildTestFailure(err));
      }
    }
  } catch (err) {
    runError = err;
    if (!(err instanceof CancelRun)) throw err;
  } finally {
    const runState = updateRunState(
      runError != null ? { completed: true, error: runError, status: 'failed' } : { completed: true },
    );
    await session.callHook('run:finished', {
      runId,
      startTime,
      duration: Date.now() - startTime,
      testFiles,
      summary,
      status: runState.status ?? (runError != null ? 'failed' : 'passed'),
      ...(runError != null ? { error: runError } : {}),
    });
    await caseEventChain;
    unsubscribe();
  }
};
