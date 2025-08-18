import * as sinon from 'sinon';

// 'any' is needed to accept 'any' functions
/* eslint-disable @typescript-eslint/no-explicit-any */

const sandbox = sinon.createSandbox();

export const clearAllSpies = (): void => {
  sandbox.restore();
};

export const fn = <T extends (...args: any[]) => any>(
  implementation?: T
): Spy<T> => {
  const stub = implementation
    ? sandbox.stub().callsFake(implementation)
    : sandbox.stub();

  const jestSpy = Object.assign(stub, {
    mock: {
      calls: [] as unknown[][],
      instances: [] as unknown[],
      contexts: [] as unknown[],
      results: [] as { type: 'return' | 'throw'; value: unknown }[],
      lastCall: null as unknown[] | null,
    },
    mockClear: () => {
      // Clear sinon internal data (the getters will now return empty arrays)
      stub.resetHistory();
      // Clear other mock tracking data that we still manage directly
      jestSpy.mock.instances = [];
      jestSpy.mock.contexts = [];
      return jestSpy;
    },
    mockReset: () => {
      jestSpy.mockClear();
      stub.resetBehavior();
      return jestSpy;
    },
    mockRestore: () => {
      if (stub.restore) {
        stub.restore();
      }
      return jestSpy;
    },
    mockReturnValue: (
      value: T extends (...args: any[]) => any ? ReturnType<T> : unknown
    ) => {
      stub.returns(value);
      return jestSpy;
    },
    mockReturnValueOnce: (
      value: T extends (...args: any[]) => any ? ReturnType<T> : unknown
    ) => {
      stub.onCall(stub.callCount).returns(value);
      return jestSpy;
    },
    mockResolvedValue: (
      value: T extends (...args: any[]) => Promise<infer R> ? R : unknown
    ) => {
      stub.resolves(value);
      return jestSpy;
    },
    mockResolvedValueOnce: (
      value: T extends (...args: any[]) => Promise<infer R> ? R : unknown
    ) => {
      stub.onCall(stub.callCount).resolves(value);
      return jestSpy;
    },
    mockRejectedValue: (value: unknown) => {
      stub.rejects(value);
      return jestSpy;
    },
    mockRejectedValueOnce: (value: unknown) => {
      stub.onCall(stub.callCount).rejects(value);
      return jestSpy;
    },
    mockImplementation: (fn: T) => {
      stub.callsFake(fn as any);
      return jestSpy;
    },
    mockImplementationOnce: (fn: T) => {
      stub.onCall(stub.callCount).callsFake(fn as any);
      return jestSpy;
    },
  });

  // Override the mock object's getters to provide real-time data
  Object.defineProperty(jestSpy.mock, 'calls', {
    get: () => {
      return stub.getCalls().map((call) => call.args);
    },
    enumerable: true,
  });

  Object.defineProperty(jestSpy.mock, 'lastCall', {
    get: () => {
      const calls = stub.getCalls().map((call) => call.args);
      return calls.length > 0 ? calls[calls.length - 1] : null;
    },
    enumerable: true,
  });

  Object.defineProperty(jestSpy.mock, 'results', {
    get: () => {
      return stub.getCalls().map((call) => {
        if (call.exception) {
          return { type: 'throw' as const, value: call.exception };
        }
        return { type: 'return' as const, value: call.returnValue };
      });
    },
    enumerable: true,
  });

  return jestSpy as unknown as Spy<T>;
};

export const spyOn = <T extends object, K extends keyof T>(
  obj: T,
  method: K
): Spy<T[K]> => {
  const stub = sandbox.stub(obj, method as keyof T);

  const jestSpy = Object.assign(stub, {
    mock: {
      calls: [] as unknown[][],
      instances: [] as unknown[],
      contexts: [] as unknown[],
      results: [] as { type: 'return' | 'throw'; value: unknown }[],
      lastCall: null as unknown[] | null,
    },
    mockClear: () => {
      // Clear sinon internal data (the getters will now return empty arrays)
      stub.resetHistory();
      // Clear other mock tracking data that we still manage directly
      jestSpy.mock.instances = [];
      jestSpy.mock.contexts = [];
      return jestSpy;
    },
    mockReset: () => {
      jestSpy.mockClear();
      stub.resetBehavior();
      return jestSpy;
    },
    mockRestore: () => {
      if (stub.restore) {
        stub.restore();
      }
      return jestSpy;
    },
    mockReturnValue: (
      value: T[K] extends (...args: any[]) => infer R ? R : unknown
    ) => {
      stub.returns(value);
      return jestSpy;
    },
    mockReturnValueOnce: (
      value: T[K] extends (...args: any[]) => infer R ? R : unknown
    ) => {
      stub.onCall(stub.callCount).returns(value);
      return jestSpy;
    },
    mockResolvedValue: (
      value: T[K] extends (...args: any[]) => Promise<infer R> ? R : unknown
    ) => {
      stub.resolves(value);
      return jestSpy;
    },
    mockResolvedValueOnce: (
      value: T[K] extends (...args: any[]) => Promise<infer R> ? R : unknown
    ) => {
      stub.onCall(stub.callCount).resolves(value);
      return jestSpy;
    },
    mockRejectedValue: (value: unknown) => {
      stub.rejects(value);
      return jestSpy;
    },
    mockRejectedValueOnce: (value: unknown) => {
      stub.onCall(stub.callCount).rejects(value);
      return jestSpy;
    },
    mockImplementation: (fn: T[K]) => {
      stub.callsFake(fn as any);
      return jestSpy;
    },
    mockImplementationOnce: (fn: T[K]) => {
      stub.onCall(stub.callCount).callsFake(fn as any);
      return jestSpy;
    },
  });

  Object.defineProperty(jestSpy.mock, 'calls', {
    get: () => {
      return stub.getCalls().map((call) => call.args);
    },
    enumerable: true,
  });

  Object.defineProperty(jestSpy.mock, 'lastCall', {
    get: () => {
      const calls = stub.getCalls().map((call) => call.args);
      return calls.length > 0 ? calls[calls.length - 1] : null;
    },
    enumerable: true,
  });

  Object.defineProperty(jestSpy.mock, 'results', {
    get: () => {
      return stub.getCalls().map((call) => {
        if (call.exception) {
          return { type: 'throw' as const, value: call.exception };
        }
        return { type: 'return' as const, value: call.returnValue };
      });
    },
    enumerable: true,
  });

  return jestSpy as unknown as Spy<T[K]>;
};

export const spy = sinon.spy;

export type Spy<T = (...args: any[]) => any> = {
  (
    ...args: T extends (...args: any[]) => any ? Parameters<T> : any[]
  ): T extends (...args: any[]) => any ? ReturnType<T> : any;
  mock: {
    calls: T extends (...args: any[]) => any ? Parameters<T>[] : unknown[][];
    instances: T extends new (...args: any[]) => infer I ? I[] : unknown[];
    contexts: T extends (this: infer C, ...args: any[]) => any
      ? C[]
      : unknown[];
    results: T extends (...args: any[]) => any
      ? { type: 'return' | 'throw'; value: ReturnType<T> | unknown }[]
      : { type: 'return' | 'throw'; value: unknown }[];
    lastCall: T extends (...args: any[]) => any
      ? Parameters<T> | null
      : unknown[] | null;
  };
  mockClear(): Spy<T>;
  mockReset(): Spy<T>;
  mockRestore(): Spy<T>;
  mockReturnValue(
    value: T extends (...args: any[]) => any ? ReturnType<T> : unknown
  ): Spy<T>;
  mockReturnValueOnce(
    value: T extends (...args: any[]) => any ? ReturnType<T> : unknown
  ): Spy<T>;
  // For Promise return types
  mockResolvedValue(
    value: T extends (...args: any[]) => Promise<infer R> ? R : unknown
  ): Spy<T>;
  mockResolvedValueOnce(
    value: T extends (...args: any[]) => Promise<infer R> ? R : unknown
  ): Spy<T>;
  mockRejectedValue(value: unknown): Spy<T>;
  mockRejectedValueOnce(value: unknown): Spy<T>;
  mockImplementation(fn: T): Spy<T>;
  mockImplementationOnce(fn: T): Spy<T>;
};
