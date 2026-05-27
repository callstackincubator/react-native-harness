import {
  afterEach,
  beforeEach,
  describe as harnessDescribe,
  getTestCollector,
  it as harnessIt,
} from '../collector/index.js';
import type { HarnessTestContext } from '@react-native-harness/bridge';
import { getTestRunner } from '../runner/index.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../symbolicate.js', async () => {
  return {
    getCodeFrame: vi.fn(async () => null),
  };
});

const getTask = (context: HarnessTestContext) => {
  return context.task;
};

const getTaskContext = (context: HarnessTestContext) => {
  return context;
};

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
          beforeEach((context: HarnessTestContext) => {
            observedTasks.push({ source: 'beforeEach', task: getTask(context) });
          });

          afterEach((context: HarnessTestContext) => {
            observedTasks.push({ source: 'afterEach', task: getTask(context) });
          });

          harnessIt('exposes task metadata', (context: HarnessTestContext) => {
            observedTasks.push({ source: 'test', task: getTask(context) });
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

          harnessIt('skips from context', (context: HarnessTestContext) => {
            const { skip } = getTaskContext(context);

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
          harnessIt('continues when condition is false', (context: HarnessTestContext) => {
            const { skip } = getTaskContext(context);

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

  it('runs onTestFinished after afterEach for passing tests', async () => {
    const calls: string[] = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Finished Suite', () => {
          afterEach(() => {
            calls.push('afterEach');
          });

          harnessIt('runs finished callbacks', (context: HarnessTestContext) => {
            const { onTestFinished } = getTaskContext(context);

            onTestFinished(() => {
              calls.push('onTestFinished:first');
            });
            onTestFinished(() => {
              calls.push('onTestFinished:second');
            });

            calls.push('test');
          });
        });
      }, 'runtime/on-test-finished-pass.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/on-test-finished-pass.test.ts',
        runner: 'ios',
      });

      expect(result.suites[0].tests[0]).toMatchObject({ status: 'passed' });
      expect(calls).toEqual([
        'test',
        'afterEach',
        'onTestFinished:second',
        'onTestFinished:first',
      ]);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('runs onTestFinished for dynamically skipped tests', async () => {
    const calls: string[] = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Finished Skip Suite', () => {
          afterEach(() => {
            calls.push('afterEach');
          });

          harnessIt(
            'runs finished callback after skip',
            (context: HarnessTestContext) => {
              const { onTestFinished, skip } = getTaskContext(context);

            onTestFinished(() => {
              calls.push('onTestFinished');
            });

            calls.push('before-skip');
            skip();
            },
          );
        });
      }, 'runtime/on-test-finished-skip.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/on-test-finished-skip.test.ts',
        runner: 'android',
      });

      expect(result.suites[0].tests[0]).toMatchObject({ status: 'skipped' });
      expect(calls).toEqual(['before-skip', 'afterEach', 'onTestFinished']);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('runs onTestFinished for failed tests', async () => {
    const calls: string[] = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Finished Failure Suite', () => {
          afterEach(() => {
            calls.push('afterEach');
          });

          harnessIt(
            'runs finished callback after failure',
            (context: HarnessTestContext) => {
              const { onTestFinished } = getTaskContext(context);

            onTestFinished(() => {
              calls.push('onTestFinished');
            });

            calls.push('test');
            throw new Error('expected failure');
            },
          );
        });
      }, 'runtime/on-test-finished-failure.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/on-test-finished-failure.test.ts',
        runner: 'ios',
      });

      expect(result.suites[0].tests[0]).toMatchObject({ status: 'failed' });
      expect(calls).toEqual(['test', 'afterEach', 'onTestFinished']);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('runs onTestFailed after afterEach for failed tests', async () => {
    const calls: string[] = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Failed Hook Suite', () => {
          afterEach(() => {
            calls.push('afterEach');
          });

          harnessIt('runs failed callbacks', (context: HarnessTestContext) => {
            const { onTestFailed } = getTaskContext(context);

            onTestFailed(() => {
              calls.push('onTestFailed:first');
            });
            onTestFailed(() => {
              calls.push('onTestFailed:second');
            });

            calls.push('test');
            throw new Error('expected failure');
          });
        });
      }, 'runtime/on-test-failed-failure.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/on-test-failed-failure.test.ts',
        runner: 'ios',
      });

      expect(result.suites[0].tests[0]).toMatchObject({ status: 'failed' });
      expect(calls).toEqual([
        'test',
        'afterEach',
        'onTestFailed:second',
        'onTestFailed:first',
      ]);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('does not run onTestFailed for dynamically skipped tests', async () => {
    const calls: string[] = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Failed Skip Suite', () => {
          afterEach(() => {
            calls.push('afterEach');
          });

          harnessIt(
            'does not run failed callbacks on skip',
            (context: HarnessTestContext) => {
              const { onTestFailed, skip } = getTaskContext(context);

            onTestFailed(() => {
              calls.push('onTestFailed');
            });

            calls.push('before-skip');
            skip();
            },
          );
        });
      }, 'runtime/on-test-failed-skip.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/on-test-failed-skip.test.ts',
        runner: 'android',
      });

      expect(result.suites[0].tests[0]).toMatchObject({ status: 'skipped' });
      expect(calls).toEqual(['before-skip', 'afterEach']);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('returns skipped descendants for describe.skip()', async () => {
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe.skip('Skipped Suite', () => {
          harnessIt('skipped test', () => undefined);

          harnessDescribe('Nested Suite', () => {
            harnessIt('nested skipped test', () => undefined);
          });
        });
      }, 'runtime/describe-skip-descendants.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/describe-skip-descendants.test.ts',
        runner: 'ios',
      });

      expect(result.suites[0]).toMatchObject({
        name: 'Skipped Suite',
        status: 'skipped',
        tests: [
          {
            name: 'skipped test',
            status: 'skipped',
          },
        ],
        suites: [
          {
            name: 'Nested Suite',
            status: 'skipped',
            tests: [
              {
                name: 'nested skipped test',
                status: 'skipped',
              },
            ],
          },
        ],
      });
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });

  it('runs onTestFailed when afterEach fails', async () => {
    const calls: string[] = [];
    const collector = getTestCollector();
    const runner = getTestRunner();

    try {
      const collection = await collector.collect(() => {
        harnessDescribe('Failed AfterEach Suite', () => {
          afterEach(() => {
            calls.push('afterEach');
            throw new Error('afterEach failure');
          });

          harnessIt(
            'runs failed callback after afterEach failure',
            (context: HarnessTestContext) => {
              const { onTestFailed } = getTaskContext(context);

            onTestFailed(() => {
              calls.push('onTestFailed');
            });

            calls.push('test');
            },
          );
        });
      }, 'runtime/on-test-failed-after-each.test.ts');

      const result = await runner.run({
        testSuite: collection.testSuite,
        testFilePath: 'runtime/on-test-failed-after-each.test.ts',
        runner: 'ios',
      });

      expect(result.suites[0].tests[0]).toMatchObject({ status: 'failed' });
      expect(calls).toEqual(['test', 'afterEach', 'onTestFailed']);
    } finally {
      collector.dispose();
      runner.dispose();
    }
  });
});
