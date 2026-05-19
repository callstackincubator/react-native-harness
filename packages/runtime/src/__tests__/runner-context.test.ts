import { describe, expect, it, vi } from 'vitest';

vi.mock('../symbolicate.js', () => ({
  getCodeFrame: vi.fn(async () => null),
}));

import {
  afterEach,
  beforeEach,
  describe as harnessDescribe,
  getTestCollector,
  it as harnessIt,
} from '../collector/index.js';
import { getTestRunner } from '../runner/index.js';

describe('runner task context', () => {
  it('passes minimal task metadata to tests and per-test hooks', async () => {
    const observedTasks: Array<{
      source: 'beforeEach' | 'test' | 'afterEach';
      task: {
        name: string;
        type: 'test';
        mode: 'run' | 'skip' | 'todo';
        file: { name: string };
        suite: { name: string };
      };
    }> = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Task Context Suite', () => {
          beforeEach((context) => {
            observedTasks.push({ source: 'beforeEach', task: context!.task });
          });

          afterEach((context) => {
            observedTasks.push({ source: 'afterEach', task: context!.task });
          });

          harnessIt('exposes task metadata', (context) => {
            observedTasks.push({ source: 'test', task: context!.task });
          });
        });
      }, 'runtime/context.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/context.test.ts',
        runner: 'ios',
      });

      expect(result.status).toBe('passed');
      expect(result.suites[0].tests[0]).toMatchObject({
        name: 'exposes task metadata',
        status: 'passed',
      });
      expect(observedTasks).toEqual([
        {
          source: 'beforeEach',
          task: {
            name: 'exposes task metadata',
            type: 'test',
            mode: 'run',
            file: { name: 'runtime/context.test.ts' },
            suite: { name: 'Task Context Suite' },
          },
        },
        {
          source: 'test',
          task: {
            name: 'exposes task metadata',
            type: 'test',
            mode: 'run',
            file: { name: 'runtime/context.test.ts' },
            suite: { name: 'Task Context Suite' },
          },
        },
        {
          source: 'afterEach',
          task: {
            name: 'exposes task metadata',
            type: 'test',
            mode: 'run',
            file: { name: 'runtime/context.test.ts' },
            suite: { name: 'Task Context Suite' },
          },
        },
      ]);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('keeps zero-argument tests and hooks working', async () => {
    const calls: string[] = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Compatibility Suite', () => {
          beforeEach(() => {
            calls.push('beforeEach');
          });

          afterEach(() => {
            calls.push('afterEach');
          });

          harnessIt('still runs', () => {
            calls.push('test');
          });
        });
      }, 'runtime/compatibility.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/compatibility.test.ts',
        runner: 'android',
      });

      expect(result.suites[0].tests[0]).toMatchObject({ status: 'passed' });
      expect(calls).toEqual(['beforeEach', 'test', 'afterEach']);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });
});
