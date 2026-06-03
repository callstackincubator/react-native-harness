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
});
