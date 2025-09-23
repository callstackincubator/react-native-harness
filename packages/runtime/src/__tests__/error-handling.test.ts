import { describe, it, expect } from 'vitest';
import * as harnessRuntime from '../collector/functions.js';
import { TestError } from '../collector/errors.js';

const noop = () => {
  // Noop
};

describe('error handling', () => {
  it('should throw TestError with proper code for invalid test names', () => {
    expect(() => {
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test('', noop);
        });
      });
    }).toThrow(TestError);

    expect(() => {
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test(null as unknown as string, noop);
        });
      });
    }).toThrow(TestError);
  });

  it('should throw TestError with proper code for invalid functions', () => {
    expect(() => {
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          // @ts-expect-error - Testing invalid input
          harnessRuntime.test('test name', null);
        });
      });
    }).toThrow(TestError);
  });

  it('should throw TestError for duplicate test names', () => {
    expect(() => {
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test('duplicate name', noop);
          harnessRuntime.test('duplicate name', noop);
        });
      });
    }).toThrow(TestError);
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

  it('should provide proper error context', () => {
    try {
      harnessRuntime.collectTests(() => {
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

  it('should validate describe function inputs', () => {
    expect(() => {
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('', noop);
      });
    }).toThrow(TestError);

    expect(() => {
      harnessRuntime.collectTests(() => {
        // @ts-expect-error - Testing invalid input
        harnessRuntime.describe('Test Suite', null);
      });
    }).toThrow(TestError);
  });

  it('should validate test modifiers', () => {
    expect(() => {
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test.skip('', noop);
        });
      });
    }).toThrow(TestError);

    expect(() => {
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test.only('', noop);
        });
      });
    }).toThrow(TestError);

    expect(() => {
      harnessRuntime.collectTests(() => {
        harnessRuntime.describe('Test Suite', () => {
          harnessRuntime.test.todo('');
        });
      });
    }).toThrow(TestError);
  });
});
