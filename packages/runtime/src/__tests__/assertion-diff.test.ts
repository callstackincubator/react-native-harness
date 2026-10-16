import { stripVTControlCharacters } from 'node:util';
import type { SerializedError } from '@react-native-harness/bridge';
import { describe, expect, it, vi } from 'vitest';
import {
  describe as harnessDescribe,
  getTestCollector,
  it as harnessIt,
} from '../collector/index.js';
import { expect as harnessExpect } from '../expect/index.js';
import { getTestRunner } from '../runner/index.js';

vi.mock('../symbolicate.js', async () => {
  return {
    getCodeFrame: vi.fn(async () => null),
  };
});

const runFailingTest = async (
  fn: () => void,
): Promise<{ result?: SerializedError; event?: SerializedError }> => {
  const collector = getTestCollector();
  const runner = getTestRunner();
  let event: SerializedError | undefined;

  runner.events.addListener((runnerEvent) => {
    if (runnerEvent.type === 'test-finished') {
      event = runnerEvent.error;
    }
  });

  try {
    const collection = await collector.collect(() => {
      harnessDescribe('Diff Suite', () => {
        harnessIt('fails', fn);
      });
    }, 'runtime/assertion-diff.test.ts');

    const result = await runner.run({
      testSuite: collection.testSuite,
      testFilePath: 'runtime/assertion-diff.test.ts',
      runner: 'ios',
    });

    expect(result.suites[0].tests[0].status).toBe('failed');

    return { result: result.suites[0].tests[0].error, event };
  } finally {
    collector.dispose();
    runner.dispose();
  }
};

const strip = (value: string | undefined) =>
  value === undefined ? undefined : stripVTControlCharacters(value);

// expect.soft is installed at runtime but missing from @vitest/expect's types.
const softExpect = (harnessExpect as unknown as { soft: typeof harnessExpect })
  .soft;

describe('assertion diffs', () => {
  it('serializes the expected/received diff of a failed assertion', async () => {
    const { result, event } = await runFailingTest(() => {
      harnessExpect({ name: 'Nitro', year: 2018 }).toEqual({
        name: 'Nitro',
        year: 2019,
      });
    });

    expect(result?.message).toContain('to deeply equal');
    expect(strip(result?.diff)).toBe(
      [
        '- Expected',
        '+ Received',
        '',
        '  {',
        '    "name": "Nitro",',
        '-   "year": 2019,',
        '+   "year": 2018,',
        '  }',
      ].join('\n'),
    );
    expect(event?.diff).toBe(result?.diff);
  });

  it('does not add a diff to errors without expected and actual values', async () => {
    const { result } = await runFailingTest(() => {
      throw new Error('plain failure');
    });

    expect(result?.message).toBe('plain failure');
    expect(result?.diff).toBeUndefined();
  });

  it('keeps the diff of every failed soft assertion', async () => {
    const { result } = await runFailingTest(() => {
      softExpect(1).toBe(2);
      softExpect('a').toBe('b');
    });

    expect(strip(result?.message)).toBe(
      [
        'Soft assertion failures:',
        'AssertionError: expected 1 to be 2 // Object.is equality',
        '- Expected\n+ Received\n\n- 2\n+ 1',
        "AssertionError: expected 'a' to be 'b' // Object.is equality",
        'Expected: "b"\nReceived: "a"',
      ].join('\n\n'),
    );
    expect(result?.diff).toBeUndefined();
  });
});
