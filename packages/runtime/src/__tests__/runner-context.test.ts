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

  it('marks dynamically skipped tests as skipped and still runs afterEach', async () => {
    const calls: string[] = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Skip Suite', () => {
          afterEach(() => {
            calls.push('afterEach');
          });

          harnessIt('skips from context', ({ skip }) => {
            calls.push('before-skip');
            skip('skip this test');
            calls.push('after-skip');
          });

          harnessIt('still runs sibling test', () => {
            calls.push('sibling');
          });
        });
      }, 'runtime/skip.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/skip.test.ts',
        runner: 'ios',
      });

      expect(result.suites[0].tests).toMatchObject([
        { name: 'skips from context', status: 'skipped' },
        { name: 'still runs sibling test', status: 'passed' },
      ]);
      expect(calls).toEqual([
        'before-skip',
        'afterEach',
        'sibling',
        'afterEach',
      ]);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('supports conditional skipping without changing false conditions', async () => {
    const calls: string[] = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Conditional Skip Suite', () => {
          harnessIt('continues when condition is false', ({ skip }) => {
            calls.push('before');
            skip(false, 'do not skip');
            calls.push('after');
          });
        });
      }, 'runtime/conditional-skip.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/conditional-skip.test.ts',
        runner: 'android',
      });

      expect(result.suites[0].tests[0]).toMatchObject({ status: 'passed' });
      expect(calls).toEqual(['before', 'after']);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });
});
