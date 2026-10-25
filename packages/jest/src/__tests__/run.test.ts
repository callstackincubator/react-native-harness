import { describe, expect, it, vi } from 'vitest';
import type { Config as JestConfig } from 'jest-runner';
import type { TestSuiteResult } from '@react-native-harness/bridge';
import type { HarnessSession } from '../harness-session.js';
import { runHarnessTestFile } from '../run.js';

vi.mock('jest-message-util', () => ({
  formatResultsErrors: vi.fn(() => ''),
}));

const createHarnessResult = (): TestSuiteResult => ({
  name: 'root',
  tests: [],
  suites: [],
  status: 'passed',
  duration: 0,
});

const createSession = (testTimeout: number): HarnessSession =>
  ({
    config: { testTimeout },
    context: {
      platform: {
        runner: './runner.js',
      },
    },
    runTestFile: vi.fn(async () => createHarnessResult()),
  }) as unknown as HarnessSession;

const createGlobalConfig = (
  overrides: Partial<JestConfig.GlobalConfig> = {},
): JestConfig.GlobalConfig =>
  ({
    rootDir: '/project',
    ...overrides,
  }) as JestConfig.GlobalConfig;

const createProjectConfig = (
  overrides: Partial<JestConfig.ProjectConfig> = {},
): JestConfig.ProjectConfig => overrides as JestConfig.ProjectConfig;

describe('runHarnessTestFile', () => {
  it('uses Harness config testTimeout when Jest config does not set one', async () => {
    const session = createSession(15000);

    await runHarnessTestFile({
      testPath: '/project/example.harness.ts',
      session,
      globalConfig: createGlobalConfig(),
      projectConfig: createProjectConfig(),
    });

    expect(session.runTestFile).toHaveBeenCalledWith(
      'example.harness.ts',
      expect.objectContaining({ testTimeout: 15000 }),
    );
  });

  it('keeps Harness config testTimeout above Jest config testTimeout', async () => {
    const session = createSession(15000);

    await runHarnessTestFile({
      testPath: '/project/example.harness.ts',
      session,
      globalConfig: createGlobalConfig({ testTimeout: 20000 } as never),
      projectConfig: createProjectConfig({ testTimeout: 30000 } as never),
    });

    expect(session.runTestFile).toHaveBeenCalledWith(
      'example.harness.ts',
      expect.objectContaining({ testTimeout: 15000 }),
    );
  });

  it('reports declaration-time and runtime skips to Jest as pending', async () => {
    const session = createSession(15000);
    vi.mocked(session.runTestFile).mockResolvedValue({
      ...createHarnessResult(),
      tests: [
        {
          name: 'passes',
          status: 'passed',
          duration: 1,
        },
        {
          name: 'declaration skip',
          status: 'skipped',
          duration: 0,
          declarationMode: 'skip',
        },
        {
          name: 'runtime skip',
          status: 'skipped',
          duration: 1,
        },
      ],
    });

    const { jestResult } = await runHarnessTestFile({
      testPath: '/project/example.harness.ts',
      session,
      globalConfig: createGlobalConfig(),
      projectConfig: createProjectConfig(),
    });

    expect(jestResult.numPendingTests).toBe(2);
    expect(jestResult.testResults).toEqual([
      expect.objectContaining({ title: 'passes', status: 'passed' }),
      expect.objectContaining({ title: 'declaration skip', status: 'pending' }),
      expect.objectContaining({ title: 'runtime skip', status: 'pending' }),
    ]);
  });
});

describe('runHarnessTestFile on Windows', () => {
  it('sends forward-slashed test and setup file paths to the device', async () => {
    vi.resetModules();
    vi.doMock('node:path', async () => {
      const actual =
        await vi.importActual<typeof import('node:path')>('node:path');
      return { ...actual.win32, default: actual.win32 };
    });

    try {
      const { runHarnessTestFile: runOnWindows } = await import('../run.js');
      const session = createSession(15000);

      await runOnWindows({
        testPath: 'C:\\project\\src\\__tests__\\a.harness.ts',
        session,
        globalConfig: createGlobalConfig({ rootDir: 'C:\\project' }),
        projectConfig: createProjectConfig({
          setupFiles: ['C:\\project\\setup\\setup.ts'],
          setupFilesAfterEnv: ['C:\\project\\setup\\after-env.ts'],
        }),
      });

      expect(session.runTestFile).toHaveBeenCalledWith(
        'src/__tests__/a.harness.ts',
        expect.objectContaining({
          setupFiles: ['setup/setup.ts'],
          setupFilesAfterEnv: ['setup/after-env.ts'],
        }),
      );
    } finally {
      vi.doUnmock('node:path');
      vi.resetModules();
    }
  });
});
