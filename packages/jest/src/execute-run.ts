import type {
  OnTestFailure,
  OnTestStart,
  OnTestSuccess,
  Test,
  TestWatcher,
  Config,
} from 'jest-runner';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { type HarnessSession, type HarnessRunState } from './harness-session.js';
import { runHarnessTestFile } from './run.js';
import {
  NativeCrashError,
  StartupStallError,
} from './errors.js';
import { DeviceNotRespondingError } from '@react-native-harness/bridge/server';

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
    err instanceof StartupStallError ||
    err instanceof DeviceNotRespondingError
  ) {
    return { message: (err as Error).message, stack: '' };
  }
  return err as { message: string; stack: string };
};

export const executeRun = async (
  session: HarnessSession,
  tests: Array<Test>,
  watcher: TestWatcher,
  onStart: OnTestStart,
  onResult: OnTestSuccess,
  onFailure: OnTestFailure,
  globalConfig: Config.GlobalConfig,
): Promise<void> => {
  const runId = randomUUID();
  const startTime = Date.now();
  const watchMode = globalConfig.watch || globalConfig.watchAll;
  const rootDir = globalConfig.rootDir ?? process.cwd();
  const testFiles = tests.map((t) => path.relative(rootDir, t.path));
  const summary = createRunSummary();

  const updateRunState = (overrides: Partial<HarnessRunState> = {}) => {
    const state: HarnessRunState = {
      runId,
      startTime,
      testFiles,
      watchMode,
      coverageEnabled: globalConfig.collectCoverage,
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
  let isFirstTest = true;
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

      try {
        if (shouldResetEnv && !isFirstTest) {
          await session.restartApp(test.path);
        }
        isFirstTest = false;

        await onStart(test);
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
        updateRunState();
        await emitTestFileFinished({
          status: result.harnessResult.status,
          duration: result.duration,
          result: result.harnessResult,
        });
        await onResult(test, result.jestResult);
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
          err instanceof StartupStallError ||
          err instanceof DeviceNotRespondingError;

        if (isRuntimeFailure) {
          summary.failed += 1;
          updateRunState();
        }

        if (err instanceof NativeCrashError) {
          session.resetCrashState();
        }

        updateRunState({ error: isRuntimeFailure ? undefined : err });
        onFailure(test, buildTestFailure(err));
      }
    }
  } catch (err) {
    runError = err;
    if (!(err instanceof CancelRun)) throw err;
  } finally {
    const runState = updateRunState(
      runError != null ? { error: runError, status: 'failed' } : {},
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
  }
};
