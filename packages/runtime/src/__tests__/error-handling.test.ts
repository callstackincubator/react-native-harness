import { describe, it, expect } from 'vitest';
import * as harnessRuntime from '../collector/functions.js';
import { TestError } from '../collector/errors.js';

const noop = () => {
  // Noop
};

describe('error handling', () => {
  it('should throw TestError with proper code for invalid test names', async () => {
    await expect(() =>
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test('', noop);
        });
      })
    ).rejects.toThrow(TestError);

    await expect(() =>
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test(null as unknown as string, noop);
        });
      })
    ).rejects.toThrow(TestError);
  });

  it('should throw TestError with proper code for invalid functions', async () => {
    await expect(() =>
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          // @ts-expect-error - Testing invalid input
          harnessRuntime.test('test name', null);
        });
      })
    ).rejects.toThrow(TestError);
  });

  it('should throw TestError for duplicate test names', async () => {
    await expect(() =>
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test('duplicate name', noop);
          harnessRuntime.test('duplicate name', noop);
        });
      })
    ).rejects.toThrow(TestError);
  });

  it('should throw TestError when calling test outside describe', () => {
    expect(() => {
      harnessRuntime.test('test name', noop);
    }).toThrow(TestError);
  });

  it('should throw TestError when calling hooks outside describe', () => {
    expect(() => {
      harnessRuntime.beforeAll(noop);
    }).toThrow(TestError);

    expect(() => {
      harnessRuntime.afterAll(noop);
    }).toThrow(TestError);

    expect(() => {
      harnessRuntime.beforeEach(noop);
    }).toThrow(TestError);

    expect(() => {
      harnessRuntime.afterEach(noop);
    }).toThrow(TestError);
  });

  it('should provide proper error context', async () => {
    try {
      await harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test('test1', noop);
          harnessRuntime.test('test1', noop);
        });
      });
    } catch (error) {
      expect(error).toBeInstanceOf(TestError);
      expect((error as TestError).code).toBe('DUPLICATE_TEST_NAME');
      expect((error as TestError).context).toEqual({
        name: 'test1',
        suiteName: 'Test Suite',
      });
    }
  });

  it('should validate describe function inputs', async () => {
    await expect(() =>
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('', noop);
      })
    ).rejects.toThrow(TestError);

    await expect(() =>
      harnessRuntime.collectTests(() => {
        // @ts-expect-error - Testing invalid input
        harnessRuntime.describe('Test Suite', null);
      })
    ).rejects.toThrow(TestError);
  });

  it('should validate test modifiers', async () => {
    await expect(() =>
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test.skip('', noop);
        });
      })
    ).rejects.toThrow(TestError);

    await expect(() =>
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test.only('', noop);
        });
      })
    ).rejects.toThrow(TestError);

    await expect(() =>
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test.todo('');
        });
      })
    ).rejects.toThrow(TestError);
  });
});
