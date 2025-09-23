import { describe, test } from 'vitest';
import { expect } from '../expect/index.js';

describe('expect - Basic Matchers', () => {
  describe('toBe', () => {
    test('should pass for identical primitive values', () => {
      expect(1).toBe(1);
      expect('hello').toBe('hello');
      expect(true).toBe(true);
      expect(null).toBe(null);
      expect(undefined).toBe(undefined);
    });

    test('should fail for different primitive values', () => {
      expect(() => expect(1).toBe(2)).toThrow();
      expect(() => expect('hello').toBe('world')).toThrow();
      expect(() => expect(true).toBe(false)).toThrow();
    });

    test('should fail for objects with same content', () => {
      expect(() => expect({}).toBe({})).toThrow();
      expect(() => expect([]).toBe([])).toThrow();
    });
  });

  describe('toEqual', () => {
    test('should pass for equal primitive values', () => {
      expect(1).toEqual(1);
      expect('hello').toEqual('hello');
      expect(true).toEqual(true);
    });

    test('should pass for equal objects', () => {
      expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 });
      expect([1, 2, 3]).toEqual([1, 2, 3]);
      expect({ nested: { value: 'test' } }).toEqual({
        nested: { value: 'test' },
      });
    });

    test('should fail for unequal objects', () => {
      expect(() => expect({ a: 1 }).toEqual({ a: 2 })).toThrow();
      expect(() => expect([1, 2]).toEqual([1, 3])).toThrow();
    });
  });

  describe('toStrictEqual', () => {
    test('should pass for strictly equal values', () => {
      expect({ a: 1 }).toStrictEqual({ a: 1 });
      expect([1, 2, 3]).toStrictEqual([1, 2, 3]);
    });

    test('should fail for objects with undefined vs missing properties', () => {
      expect(() =>
        expect({ a: 1, b: undefined }).toStrictEqual({ a: 1 })
      ).toThrow();
    });

    test('should differentiate between sparse and dense arrays', () => {
      const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
      const dense = [1, undefined, 3];
      expect(() => expect(sparse).toStrictEqual(dense)).toThrow();
    });
  });
});

describe('expect - Truthiness', () => {
  describe('toBeTruthy', () => {
    test('should pass for truthy values', () => {
      expect(true).toBeTruthy();
      expect(1).toBeTruthy();
      expect('hello').toBeTruthy();
      expect({}).toBeTruthy();
      expect([]).toBeTruthy();
      expect(function () {}).toBeTruthy();
    });

    test('should fail for falsy values', () => {
      expect(() => expect(false).toBeTruthy()).toThrow();
      expect(() => expect(0).toBeTruthy()).toThrow();
      expect(() => expect('').toBeTruthy()).toThrow();
      expect(() => expect(null).toBeTruthy()).toThrow();
      expect(() => expect(undefined).toBeTruthy()).toThrow();
      expect(() => expect(NaN).toBeTruthy()).toThrow();
    });
  });

  describe('toBeFalsy', () => {
    test('should pass for falsy values', () => {
      expect(false).toBeFalsy();
      expect(0).toBeFalsy();
      expect('').toBeFalsy();
      expect(null).toBeFalsy();
      expect(undefined).toBeFalsy();
      expect(NaN).toBeFalsy();
    });

    test('should fail for truthy values', () => {
      expect(() => expect(true).toBeFalsy()).toThrow();
      expect(() => expect(1).toBeFalsy()).toThrow();
      expect(() => expect('hello').toBeFalsy()).toThrow();
    });
  });
});

describe('expect - Numbers', () => {
  describe('toBeGreaterThan', () => {
    test('should pass when value is greater', () => {
      expect(5).toBeGreaterThan(3);
      expect(0).toBeGreaterThan(-1);
      expect(1.5).toBeGreaterThan(1.4);
    });

    test('should fail when value is equal or less', () => {
      expect(() => expect(3).toBeGreaterThan(5)).toThrow();
      expect(() => expect(3).toBeGreaterThan(3)).toThrow();
    });
  });

  describe('toBeGreaterThanOrEqual', () => {
    test('should pass when value is greater or equal', () => {
      expect(5).toBeGreaterThanOrEqual(3);
      expect(3).toBeGreaterThanOrEqual(3);
      expect(0).toBeGreaterThanOrEqual(-1);
    });

    test('should fail when value is less', () => {
      expect(() => expect(3).toBeGreaterThanOrEqual(5)).toThrow();
    });
  });

  describe('toBeLessThan', () => {
    test('should pass when value is less', () => {
      expect(3).toBeLessThan(5);
      expect(-1).toBeLessThan(0);
      expect(1.4).toBeLessThan(1.5);
    });

    test('should fail when value is equal or greater', () => {
      expect(() => expect(5).toBeLessThan(3)).toThrow();
      expect(() => expect(3).toBeLessThan(3)).toThrow();
    });
  });

  describe('toBeLessThanOrEqual', () => {
    test('should pass when value is less or equal', () => {
      expect(3).toBeLessThanOrEqual(5);
      expect(3).toBeLessThanOrEqual(3);
      expect(-1).toBeLessThanOrEqual(0);
    });

    test('should fail when value is greater', () => {
      expect(() => expect(5).toBeLessThanOrEqual(3)).toThrow();
    });
  });

  describe('toBeCloseTo', () => {
    test('should pass for values close to each other', () => {
      expect(0.2 + 0.1).toBeCloseTo(0.3);
      expect(0.2 + 0.1).toBeCloseTo(0.3, 5);
    });

    test('should fail for values far apart', () => {
      expect(() => expect(0.1).toBeCloseTo(0.2)).toThrow();
    });

    test('should respect precision parameter', () => {
      expect(1.23456).toBeCloseTo(1.23, 2);
      expect(() => expect(1.23456).toBeCloseTo(1.23, 4)).toThrow();
    });
  });

  describe('toBeNaN', () => {
    test('should pass for NaN', () => {
      expect(NaN).toBeNaN();
      expect(Number('not a number')).toBeNaN();
      expect(0 / 0).toBeNaN();
    });

    test('should fail for numbers', () => {
      expect(() => expect(1).toBeNaN()).toThrow();
      expect(() => expect(0).toBeNaN()).toThrow();
      expect(() => expect(Infinity).toBeNaN()).toThrow();
    });
  });
});

describe('expect - Strings', () => {
  describe('toMatch', () => {
    test('should pass for matching strings', () => {
      expect('hello world').toMatch('world');
      expect('hello world').toMatch(/world/);
      expect('hello world').toMatch(/^hello/);
    });

    test('should fail for non-matching strings', () => {
      expect(() => expect('hello world').toMatch('xyz')).toThrow();
      expect(() => expect('hello world').toMatch(/xyz/)).toThrow();
    });
  });

  describe('toContain', () => {
    test('should pass for strings containing substring', () => {
      expect('hello world').toContain('world');
      expect('hello world').toContain('hello');
      expect('hello world').toContain(' ');
    });

    test('should fail for strings not containing substring', () => {
      expect(() => expect('hello world').toContain('xyz')).toThrow();
    });
  });

  describe('toHaveLength', () => {
    test('should pass for correct string length', () => {
      expect('hello').toHaveLength(5);
      expect('').toHaveLength(0);
    });

    test('should fail for incorrect string length', () => {
      expect(() => expect('hello').toHaveLength(3)).toThrow();
    });
  });
});

describe('expect - Arrays and Iterables', () => {
  describe('toContain for arrays', () => {
    test('should pass for arrays containing value', () => {
      expect([1, 2, 3]).toContain(2);
      expect(['a', 'b', 'c']).toContain('b');
    });

    test('should fail for arrays not containing value', () => {
      expect(() => expect([1, 2, 3]).toContain(4)).toThrow();
    });
  });

  describe('toContainEqual', () => {
    test('should pass for arrays containing equal object', () => {
      expect([{ id: 1 }, { id: 2 }]).toContainEqual({ id: 1 });
      expect([
        [1, 2],
        [3, 4],
      ]).toContainEqual([1, 2]);
    });

    test('should fail for arrays not containing equal object', () => {
      expect(() => expect([{ id: 1 }]).toContainEqual({ id: 2 })).toThrow();
    });
  });

  describe('toHaveLength for arrays', () => {
    test('should pass for correct array length', () => {
      expect([1, 2, 3]).toHaveLength(3);
      expect([]).toHaveLength(0);
    });

    test('should fail for incorrect array length', () => {
      expect(() => expect([1, 2, 3]).toHaveLength(2)).toThrow();
    });
  });
});

describe('expect - Objects', () => {
  describe('toHaveProperty', () => {
    test('should pass for existing properties', () => {
      const obj = { a: 1, b: { c: 2 } };
      expect(obj).toHaveProperty('a');
      expect(obj).toHaveProperty('b.c');
      expect(obj).toHaveProperty(['b', 'c']);
    });

    test('should pass for existing properties with values', () => {
      const obj = { a: 1, b: { c: 2 } };
      expect(obj).toHaveProperty('a', 1);
      expect(obj).toHaveProperty('b.c', 2);
    });

    test('should fail for non-existing properties', () => {
      const obj = { a: 1 };
      expect(() => expect(obj).toHaveProperty('b')).toThrow();
      expect(() => expect(obj).toHaveProperty('a.b')).toThrow();
    });

    test('should fail for wrong property values', () => {
      const obj = { a: 1 };
      expect(() => expect(obj).toHaveProperty('a', 2)).toThrow();
    });
  });

  describe('toMatchObject', () => {
    test('should pass for matching object subset', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(obj).toMatchObject({ a: 1, b: 2 });
      expect(obj).toMatchObject({ a: 1 });
    });

    test('should pass for nested object matching', () => {
      const obj = { a: { b: { c: 1 } }, d: 2 };
      expect(obj).toMatchObject({ a: { b: { c: 1 } } });
    });

    test('should fail for non-matching properties', () => {
      const obj = { a: 1, b: 2 };
      expect(() => expect(obj).toMatchObject({ a: 2 })).toThrow();
      expect(() => expect(obj).toMatchObject({ c: 3 })).toThrow();
    });
  });
});

describe('expect - Type Checking', () => {
  describe('toBeInstanceOf', () => {
    test('should pass for correct instances', () => {
      expect(new Date()).toBeInstanceOf(Date);
      expect([]).toBeInstanceOf(Array);
      expect(new Error()).toBeInstanceOf(Error);
      expect(/regex/).toBeInstanceOf(RegExp);
    });

    test('should fail for incorrect instances', () => {
      expect(() => expect('string').toBeInstanceOf(Date)).toThrow();
      expect(() => expect(123).toBeInstanceOf(String)).toThrow();
    });
  });

  describe('toBeTypeOf', () => {
    test('should pass for correct types', () => {
      expect('hello').toBeTypeOf('string');
      expect(123).toBeTypeOf('number');
      expect(true).toBeTypeOf('boolean');
      expect(undefined).toBeTypeOf('undefined');
      expect(Symbol('test')).toBeTypeOf('symbol');
      expect(() => {}).toBeTypeOf('function');
      expect({}).toBeTypeOf('object');
    });

    test('should fail for incorrect types', () => {
      expect(() => expect('hello').toBeTypeOf('number')).toThrow();
      expect(() => expect(123).toBeTypeOf('string')).toThrow();
    });
  });

  describe('toBeDefined', () => {
    test('should pass for defined values', () => {
      expect(0).toBeDefined();
      expect('').toBeDefined();
      expect(false).toBeDefined();
      expect(null).toBeDefined();
      expect({}).toBeDefined();
    });

    test('should fail for undefined', () => {
      expect(() => expect(undefined).toBeDefined()).toThrow();
    });
  });

  describe('toBeUndefined', () => {
    test('should pass for undefined', () => {
      expect(undefined).toBeUndefined();
      let uninitialized;
      expect(uninitialized).toBeUndefined();
    });

    test('should fail for defined values', () => {
      expect(() => expect(null).toBeUndefined()).toThrow();
      expect(() => expect(0).toBeUndefined()).toThrow();
    });
  });

  describe('toBeNull', () => {
    test('should pass for null', () => {
      expect(null).toBeNull();
    });

    test('should fail for non-null values', () => {
      expect(() => expect(undefined).toBeNull()).toThrow();
      expect(() => expect(0).toBeNull()).toThrow();
    });
  });
});

describe('expect - Exceptions', () => {
  describe('toThrow', () => {
    test('should pass for functions that throw', () => {
      expect(() => {
        throw new Error('test error');
      }).toThrow();

      expect(() => {
        throw new Error('test error');
      }).toThrow('test error');

      expect(() => {
        throw new Error('test error');
      }).toThrow(/test/);
    });

    test('should pass for specific error types', () => {
      expect(() => {
        throw new TypeError('type error');
      }).toThrow(TypeError);

      expect(() => {
        throw new RangeError('range error');
      }).toThrow(RangeError);
    });

    test('should fail for functions that do not throw', () => {
      expect(() => expect(() => {}).toThrow()).toThrow();
    });

    test('should fail for wrong error message', () => {
      expect(() => {
        expect(() => {
          throw new Error('actual message');
        }).toThrow('expected message');
      }).toThrow();
    });

    test('should fail for wrong error type', () => {
      expect(() => {
        expect(() => {
          throw new Error('test');
        }).toThrow(TypeError);
      }).toThrow();
    });
  });

  describe('toThrowError', () => {
    test('should be alias for toThrow', () => {
      expect(() => {
        throw new Error('test');
      }).toThrowError();

      expect(() => {
        throw new Error('test');
      }).toThrowError('test');
    });
  });
});

describe('expect - Asymmetric Matchers', () => {
  describe('expect.any', () => {
    test('should match any instance of constructor', () => {
      expect('hello').toEqual(expect.any(String));
      expect(123).toEqual(expect.any(Number));
      expect({}).toEqual(expect.any(Object));
      expect([]).toEqual(expect.any(Array));
      expect(new Date()).toEqual(expect.any(Date));
    });

    test('should work in object matching', () => {
      expect({ id: 1, name: 'test' }).toEqual({
        id: expect.any(Number),
        name: expect.any(String),
      });
    });
  });

  describe('expect.anything', () => {
    test('should match any defined value', () => {
      expect('hello').toEqual(expect.anything());
      expect(123).toEqual(expect.anything());
      expect({}).toEqual(expect.anything());
      expect([]).toEqual(expect.anything());
    });

    test('should not match undefined', () => {
      expect(() => expect(undefined).toEqual(expect.anything())).toThrow();
    });
  });

  describe('expect.arrayContaining', () => {
    test('should match arrays containing all specified elements', () => {
      expect([1, 2, 3, 4]).toEqual(expect.arrayContaining([2, 3]));
      expect(['a', 'b', 'c']).toEqual(expect.arrayContaining(['b']));
    });

    test('should fail when array does not contain all elements', () => {
      expect(() =>
        expect([1, 2, 3]).toEqual(expect.arrayContaining([4, 5]))
      ).toThrow();
    });
  });

  describe('expect.objectContaining', () => {
    test('should match objects containing specified properties', () => {
      expect({ a: 1, b: 2, c: 3 }).toEqual(
        expect.objectContaining({ a: 1, b: 2 })
      );
      expect({ name: 'test', id: 1 }).toEqual(
        expect.objectContaining({ name: 'test' })
      );
    });

    test('should fail when object does not contain specified properties', () => {
      expect(() =>
        expect({ a: 1 }).toEqual(expect.objectContaining({ b: 2 }))
      ).toThrow();
    });
  });

  describe('expect.stringContaining', () => {
    test('should match strings containing substring', () => {
      expect('hello world').toEqual(expect.stringContaining('world'));
      expect('hello world').toEqual(expect.stringContaining('hello'));
    });

    test('should fail when string does not contain substring', () => {
      expect(() =>
        expect('hello world').toEqual(expect.stringContaining('xyz'))
      ).toThrow();
    });
  });

  describe('expect.stringMatching', () => {
    test('should match strings matching regex', () => {
      expect('hello world').toEqual(expect.stringMatching(/world/));
      expect('hello world').toEqual(expect.stringMatching('world'));
    });

    test('should fail when string does not match pattern', () => {
      expect(() =>
        expect('hello world').toEqual(expect.stringMatching(/xyz/))
      ).toThrow();
    });
  });
});

describe('expect - Negation', () => {
  test('should negate basic matchers with .not', () => {
    expect(1).not.toBe(2);
    expect('hello').not.toEqual('world');
    expect([1, 2, 3]).not.toContain(4);
    expect({ a: 1 }).not.toHaveProperty('b');
  });

  test('should negate truthiness', () => {
    expect(false).not.toBeTruthy();
    expect(true).not.toBeFalsy();
    expect(0).not.toBeTruthy();
  });

  test('should negate type checks', () => {
    expect('string').not.toBeTypeOf('number');
    expect(undefined).not.toBeDefined();
    expect(123).not.toBeUndefined();
  });
});

describe('expect - Custom Messages', () => {
  test('should support custom error messages', () => {
    expect(() => {
      expect(1, 'This is a custom message').toBe(2);
    }).toThrow('This is a custom message');
  });
});

describe('expect - Edge Cases', () => {
  test('should handle circular references', () => {
    const circular: any = { a: 1 };
    circular.self = circular;

    const circular2: any = { a: 1 };
    circular2.self = circular2;

    expect(circular).toEqual(circular2);
  });

  test('should handle sparse arrays', () => {
    const sparse1 = [1, , 3]; // eslint-disable-line no-sparse-arrays
    const sparse2 = [1, , 3]; // eslint-disable-line no-sparse-arrays
    expect(sparse1).toEqual(sparse2);
  });

  test('should handle special number values', () => {
    expect(Infinity).toBe(Infinity);
    expect(-Infinity).toBe(-Infinity);
    expect(0).toBe(0);
    expect(-0).toBe(-0);
  });

  test('should handle Date objects', () => {
    const date1 = new Date('2023-01-01');
    const date2 = new Date('2023-01-01');
    expect(date1).toEqual(date2);
    expect(date1).not.toBe(date2);
  });

  test('should handle RegExp objects', () => {
    expect(/abc/g).toEqual(/abc/g);
    expect(/abc/g).not.toBe(/abc/g);
  });

  test('should handle Symbol primitives', () => {
    const sym1 = Symbol('test');
    const sym2 = Symbol('test');
    expect(sym1).toBe(sym1);
    expect(sym1).not.toBe(sym2);
  });

  test('should handle Map objects', () => {
    const map1 = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const map2 = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    expect(map1).toEqual(map2);
  });

  test('should handle Set objects', () => {
    const set1 = new Set([1, 2, 3]);
    const set2 = new Set([1, 2, 3]);
    expect(set1).toEqual(set2);
  });
});
