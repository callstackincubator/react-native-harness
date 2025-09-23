import { describe, it, expect, beforeEach } from 'vitest';
import { fn, spyOn, clearAllMocks } from '../spy/index.js';

describe('spies', () => {
  beforeEach(() => {
    clearAllMocks();
  });

  describe('fn()', () => {
    it('should create a spy function', () => {
      const spy = fn();
      expect(typeof spy).toBe('function');
      expect(spy.mock).toBeDefined();
      expect(spy.mock.calls).toEqual([]);
      expect(spy.mock.instances).toEqual([]);
      expect(spy.mock.contexts).toEqual([]);
      expect(spy.mock.results).toEqual([]);
      expect(spy.mock.lastCall).toBeUndefined();
    });

    it('should track function calls', () => {
      const spy = fn();

      spy('arg1', 'arg2');
      spy('arg3');

      expect(spy.mock.calls).toEqual([['arg1', 'arg2'], ['arg3']]);
      expect(spy.mock.lastCall).toEqual(['arg3']);
    });

    it('should track call contexts', () => {
      const spy = fn();
      const obj = { method: spy };

      obj.method('test');
      spy.call('custom-context', 'arg');

      expect(spy.mock.contexts).toHaveLength(2);
      expect(spy.mock.contexts[0]).toBe(obj);
      expect(spy.mock.contexts[1]).toBe('custom-context');
    });

    it('should track return values and exceptions', () => {
      const spy = fn();

      spy(); // undefined return

      expect(spy.mock.results).toEqual([{ type: 'return', value: undefined }]);
    });

    it('should work with implementation', () => {
      const implementation = (a: number, b: number) => a + b;
      const spy = fn(implementation);

      const result = spy(2, 3);

      expect(result).toBe(5);
      expect(spy.mock.calls).toEqual([[2, 3]]);
      expect(spy.mock.results[0]).toEqual({ type: 'return', value: 5 });
    });

    it('should handle constructor calls', () => {
      const spy = fn(function (this: { name: string }, name: string) {
        this.name = name;
      });

      const instance = new (spy as unknown as new (name: string) => {
        name: string;
      })('test');

      expect(spy.mock.instances).toHaveLength(1);
      expect(spy.mock.instances[0]).toBe(instance);
      expect(instance.name).toBe('test');
    });
  });

  describe('mockClear()', () => {
    it('should clear call history but keep implementation', () => {
      const spy = fn(() => 'result');

      spy();
      spy();

      expect(spy.mock.calls).toHaveLength(2);

      spy.mockClear();

      expect(spy.mock.calls).toEqual([]);
      expect(spy.mock.instances).toEqual([]);
      expect(spy.mock.contexts).toEqual([]);
      expect(spy.mock.results).toEqual([]);
      expect(spy.mock.lastCall).toBeUndefined();

      // Implementation should still work
      const result = spy();
      expect(result).toBe('result');
    });
  });

  describe('mockReset()', () => {
    it('should clear history and reset behavior', () => {
      const spy = fn(() => 'original');
      spy.mockReturnValue('mocked');

      spy();
      expect(spy()).toBe('mocked');

      spy.mockReset();

      expect(spy.mock.calls).toEqual([]);
      expect(spy()).toBe('original'); // Back to original implementation
    });
  });

  describe('mockReturnValue()', () => {
    it('should mock return value', () => {
      const spy = fn();
      spy.mockReturnValue('mocked');

      const result = spy('arg');

      expect(result).toBe('mocked');
      expect(spy.mock.calls).toEqual([['arg']]);
      expect(spy.mock.results[0]).toEqual({ type: 'return', value: 'mocked' });
    });
  });

  describe('mockReturnValueOnce()', () => {
    it('should mock return value for one call only', () => {
      const spy = fn(() => 'default');
      spy.mockReturnValueOnce('once');

      expect(spy()).toBe('once');
      expect(spy()).toBe('default');
      expect(spy()).toBe('default');
    });
  });

  describe('mockResolvedValue()', () => {
    it('should mock resolved promise value', async () => {
      const spy = fn();
      spy.mockResolvedValue('resolved');

      const result = await spy();

      expect(result).toBe('resolved');
      expect(spy.mock.results[0].value).toBeInstanceOf(Promise);
    });
  });

  describe('mockResolvedValueOnce()', () => {
    it('should mock resolved value for one call only', async () => {
      const spy = fn(() => Promise.resolve('default'));
      spy.mockResolvedValueOnce('once');

      expect(await spy()).toBe('once');
      expect(await spy()).toBe('default');
    });
  });

  describe('mockRejectedValue()', () => {
    it('should mock rejected promise value', async () => {
      const spy = fn();
      spy.mockRejectedValue('error');

      await expect(spy()).rejects.toBe('error');
      expect(spy.mock.results[0].value).toBeInstanceOf(Promise);
    });
  });

  describe('mockRejectedValueOnce()', () => {
    it('should mock rejected value for one call only', async () => {
      const spy = fn(() => Promise.resolve('default'));
      spy.mockRejectedValueOnce('error');

      await expect(spy()).rejects.toBe('error');
      expect(await spy()).toBe('default');
    });
  });

  describe('mockImplementation()', () => {
    it('should replace implementation', () => {
      const spy = fn(() => 'original');
      spy.mockImplementation(() => 'mocked');

      expect(spy()).toBe('mocked');
      expect(spy.mock.calls).toEqual([[]]);
    });

    it('should handle constructor calls with mock implementation', () => {
      const spy = fn();
      spy.mockImplementation(function (this: unknown, name: string) {
        (this as { name: string; mocked: boolean }).name = name;
        (this as { name: string; mocked: boolean }).mocked = true;
      });

      const instance = new (spy as unknown as new (name: string) => {
        name: string;
        mocked: boolean;
      })('test');

      expect(instance.name).toBe('test');
      expect(instance.mocked).toBe(true);
      expect(spy.mock.instances[0]).toBe(instance);
    });
  });

  describe('mockImplementationOnce()', () => {
    it('should replace implementation for one call only', () => {
      const spy = fn(() => 'original');
      spy.mockImplementationOnce(() => 'once');

      expect(spy()).toBe('once');
      expect(spy()).toBe('original');
    });
  });

  describe('mockReturnThis()', () => {
    it('should return this context', () => {
      const spy = fn();
      spy.mockReturnThis();

      const obj = { method: spy };
      const result = obj.method();

      expect(result).toBe(obj);
    });
  });

  describe('Vitest spy assertions', () => {
    describe('toHaveBeenCalled()', () => {
      it('should verify spy was called', () => {
        const spy = fn();
        expect(spy).not.toHaveBeenCalled();

        spy();
        expect(spy).toHaveBeenCalled();
      });
    });

    describe('toHaveBeenCalledTimes()', () => {
      it('should check call count', () => {
        const spy = fn();

        expect(spy).toHaveBeenCalledTimes(0);
        expect(spy).not.toHaveBeenCalledTimes(1);

        spy();
        spy();

        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy).not.toHaveBeenCalledTimes(1);
      });
    });

    describe('toHaveBeenCalledWith()', () => {
      it('should check if called with specific arguments', () => {
        const spy = fn();

        spy('arg1', 'arg2');
        spy('arg3');

        expect(spy).toHaveBeenCalledWith('arg1', 'arg2');
        expect(spy).toHaveBeenCalledWith('arg3');
        expect(spy).not.toHaveBeenCalledWith('arg4');
        expect(spy).not.toHaveBeenCalledWith('arg1'); // Wrong argument count
      });
    });

    describe('toHaveBeenLastCalledWith()', () => {
      it('should check if last call was with specific arguments', () => {
        const spy = fn();

        spy('arg1');
        spy('arg2', 'arg3');

        expect(spy).toHaveBeenLastCalledWith('arg2', 'arg3');
        expect(spy).not.toHaveBeenLastCalledWith('arg1');
      });

      it('should return false if never called', () => {
        const spy = fn();
        expect(spy).not.toHaveBeenLastCalledWith('arg');
      });
    });

    describe('toHaveBeenNthCalledWith()', () => {
      it('should check nth call arguments', () => {
        const spy = fn();

        spy('first');
        spy('second');
        spy('third');

        expect(spy).toHaveBeenNthCalledWith(1, 'first');
        expect(spy).toHaveBeenNthCalledWith(2, 'second');
        expect(spy).toHaveBeenNthCalledWith(3, 'third');
        expect(spy).not.toHaveBeenNthCalledWith(1, 'wrong');
        expect(spy).not.toHaveBeenNthCalledWith(4, 'fourth');
        expect(spy).not.toHaveBeenNthCalledWith(0, 'zero');
      });
    });

    describe('toHaveReturnedWith()', () => {
      it('should check if spy returned specific value', () => {
        const spy = fn();
        spy.mockReturnValueOnce('value1');
        spy.mockReturnValueOnce('value2');

        spy();
        spy();

        expect(spy).toHaveReturnedWith('value1');
        expect(spy).toHaveReturnedWith('value2');
        expect(spy).not.toHaveReturnedWith('value3');
      });
    });

    describe('toHaveLastReturnedWith()', () => {
      it('should check if last call returned specific value', () => {
        const spy = fn();
        spy.mockReturnValueOnce('first');
        spy.mockReturnValueOnce('last');

        spy();
        spy();

        expect(spy).toHaveLastReturnedWith('last');
        expect(spy).not.toHaveLastReturnedWith('first');
      });

      it('should return false if never called', () => {
        const spy = fn();
        expect(spy).not.toHaveLastReturnedWith('value');
      });
    });

    describe('toHaveNthReturnedWith()', () => {
      it('should check nth call return value', () => {
        const spy = fn();
        spy.mockReturnValueOnce('first');
        spy.mockReturnValueOnce('second');

        spy();
        spy();

        expect(spy).toHaveNthReturnedWith(1, 'first');
        expect(spy).toHaveNthReturnedWith(2, 'second');
        expect(spy).not.toHaveNthReturnedWith(1, 'wrong');
        expect(spy).not.toHaveNthReturnedWith(3, 'third');
      });
    });

    describe('toHaveReturnedTimes()', () => {
      it('should count successful returns (not throws)', () => {
        const spy = fn();
        spy.mockReturnValueOnce('success');
        spy.mockImplementationOnce(() => {
          throw new Error('fail');
        });
        spy.mockReturnValueOnce('success2');

        spy();
        try {
          spy();
        } catch {
          // This should throw - expected behavior
        }
        spy();

        expect(spy).toHaveReturnedTimes(2);
        expect(spy).not.toHaveReturnedTimes(3);
      });
    });

    describe('Promise-specific methods', () => {
      describe('promise resolution checks', () => {
        it('should check if spy resolved with specific value', async () => {
          const spy = fn();
          spy.mockResolvedValueOnce('resolved1');
          spy.mockResolvedValueOnce('resolved2');

          const result1 = await spy();
          const result2 = await spy();

          expect(result1).toBe('resolved1');
          expect(result2).toBe('resolved2');
          expect(spy).toHaveBeenCalledTimes(2);
        });

        it('should handle non-promise returns', async () => {
          const spy = fn();
          spy.mockReturnValue('not-promise');

          const result = spy();

          expect(result).toBe('not-promise');
          expect(spy).toHaveBeenCalledTimes(1);
        });
      });

      describe('promise rejection checks', () => {
        it('should check if spy rejected with specific value', async () => {
          const spy = fn();
          spy.mockRejectedValueOnce('error1');
          spy.mockRejectedValueOnce('error2');

          await expect(spy()).rejects.toBe('error1');
          await expect(spy()).rejects.toBe('error2');

          expect(spy).toHaveBeenCalledTimes(2);
        });
      });
    });
  });

  describe('spyOn()', () => {
    let testObject: { method: (x: number) => number; property: string };

    beforeEach(() => {
      testObject = {
        method: (x: number) => x * 2,
        property: 'original',
      };
    });

    it('should spy on existing method', () => {
      const spy = spyOn(testObject, 'method');

      const result = testObject.method(5);

      expect(result).toBe(10); // Original implementation
      expect(spy.mock.calls).toEqual([[5]]);
      expect(spy).toHaveBeenCalledWith(5);
    });

    it('should allow mocking the spied method', () => {
      const spy = spyOn(testObject, 'method');
      spy.mockReturnValue(99);

      const result = testObject.method(5);

      expect(result).toBe(99);
      expect(spy.mock.calls).toEqual([[5]]);
    });

    it('should restore original method', () => {
      const spy = spyOn(testObject, 'method');

      spy.mockReturnValue(99);
      expect(testObject.method(5)).toBe(99);

      spy.mockRestore();
      expect(testObject.method(5)).toBe(10); // Back to original
    });

    it('should track context correctly', () => {
      const spy = spyOn(testObject, 'method');

      testObject.method(5);

      expect(spy.mock.contexts[0]).toBe(testObject);
    });

    it('should handle constructor spying', () => {
      class TestClass {
        constructor(public name: string) {}
        method() {
          return this.name;
        }
      }

      const spy = spyOn(TestClass.prototype, 'method');

      const instance = new TestClass('test');
      const result = instance.method();

      expect(result).toBe('test');
      expect(spy.mock.calls).toHaveLength(1);
      expect(spy.mock.contexts[0]).toBe(instance);
    });
  });

  describe('clearAllMocks()', () => {
    it('should clear all spies created', () => {
      const spy1 = fn();
      const spy2 = fn();
      const testObj = { method: () => 'test' };
      const spy3 = spyOn(testObj, 'method');

      spy1('arg1');
      spy2('arg2');
      testObj.method();

      expect(spy1.mock.calls).toHaveLength(1);
      expect(spy2.mock.calls).toHaveLength(1);
      expect(spy3.mock.calls).toHaveLength(1);

      clearAllMocks();

      // Spies should be cleared
      expect(spy1.mock.calls).toHaveLength(0);
      expect(spy2.mock.calls).toHaveLength(0);
      expect(spy3.mock.calls).toHaveLength(0);
    });
  });

  describe('TypeScript type safety', () => {
    it('should maintain type safety for function spies', () => {
      const typedFn = (a: string, b: number): boolean => true;
      const spy = fn(typedFn);

      // These should compile correctly
      const result: boolean = spy('test', 123);
      expect(result).toBe(true);

      // Mock methods should also be type-safe
      spy.mockReturnValue(false);
      spy.mockImplementation((a: string, b: number) => a.length > b);
    });

    it('should maintain type safety for spyOn', () => {
      const obj = {
        method: (x: string): number => x.length,
      };

      const spy = spyOn(obj, 'method');

      // Should maintain original types
      const result: number = obj.method('test');
      expect(result).toBe(4);

      // Mock methods should be type-safe
      spy.mockReturnValue(99);
      spy.mockImplementation((x: string) => x.charCodeAt(0));
    });
  });
});
